import { randomBytes } from "node:crypto";
import { chmod, lstat, mkdtemp, readFile, readdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { Database } from "bun:sqlite";
import release from "./release.lock.json";
import type { DockerCommandService } from "../../src/features/execution/services/docker-command.service";
import type { CurlToolData } from "../../src/features/tool/curl/types/curl.types";
import type { ToolModule } from "../../src/features/tool/shared/types/tool-screen.types";

const platform = "linux/arm64";
const imageTagSuffix = `${release.resolvedAt}-arm64`;
const installationId = "curl-app-qualification";
const checks: Array<{ name: string; passed: boolean; detail: string }> = [];
const approvedRequests: Array<{ method: string; path: string; query: string; header: string | null; body: string }> = [];
const forbiddenRequests: string[] = [];
let heldRequestCount = 0;
let heldRequest: (() => void) | null = null;
let dockerHostAddress: string | null = null;
const forbidden = Bun.serve({
  hostname: "127.0.0.1",
  port: 0,
  fetch(request) {
    forbiddenRequests.push(new URL(request.url).pathname);
    return new Response("forbidden\n", { status: 200 });
  },
});
const approved = Bun.serve({
  hostname: "127.0.0.1",
  port: 0,
  async fetch(request) {
    const url = new URL(request.url);
    if (url.pathname === "/hold") {
      heldRequestCount += 1;
      heldRequest?.();
      return new Promise<Response>(() => undefined);
    }
    approvedRequests.push({
      method: request.method,
      path: url.pathname,
      query: url.search,
      header: request.headers.get("x-qualification"),
      body: await request.text(),
    });
    if (url.pathname === "/redirect") {
      return new Response(null, {
        status: 302,
        headers: { location: `http://${dockerHostAddress}:${forbidden.port}/redirect-target` },
      });
    }
    const echoed = `${url.searchParams.get("token") ?? ""} ${request.headers.get("x-qualification") ?? ""} ${approvedRequests.at(-1)?.body ?? ""}`;
    return new Response(`echo ${echoed}\n`);
  },
});

const appDataDirectory = await mkdtemp(join(tmpdir(), "nulltrace-curl-app-"));
const brokerDirectory = await mkdtemp(join(tmpdir(), "nulltrace-curl-broker-"));
await chmod(appDataDirectory, 0o700);
await chmod(brokerDirectory, 0o700);
process.env.NULLTRACE_APP_DATA_DIR = appDataDirectory;
process.env.NULLTRACE_EXECUTION_BROKER_DIR = brokerDirectory;

let brokerProcess: ReturnType<typeof Bun.spawn> | null = null;
let brokerKey: Buffer | null = null;
let dockerService: DockerCommandService | null = null;
let closeSessionDatabase: (() => void) | null = null;
let preserveBrokerDirectory = false;
const brokerStdout: string[] = [];
const brokerStderr: string[] = [];
let brokerOutputTasks: Promise<void>[] = [];
try {
  const { DockerCommandService } = await import("../../src/features/execution/services/docker-command.service");
  const { provisionExecutionBrokerJournal } = await import("../../src/features/execution/services/execution-broker-journal.helpers");
  const { ExecutionAuthorizationLedgerRepository } = await import("../../src/features/execution/services/execution-authorization-ledger.repository");
  const { sessionRepository } = await import("../../src/features/session/services/session.repository");
  const { sessionDatabase } = await import("../../src/features/session/services/session-database");
  closeSessionDatabase = () => sessionDatabase.close();
  const { ToolRunnerService } = await import("../../src/features/tool/shared/services/tool-runner.service");
  const { toolRegistry } = await import("../../src/features/tool/shared/registry/tool-registry");
  const dockerExecutable = Bun.which("docker");
  if (!dockerExecutable) throw new Error("Docker CLI is unavailable.");
  const docker = new DockerCommandService(dockerExecutable);
  dockerService = docker;
  const dockerContext = await docker.run(["context", "show"], { timeoutMs: 10_000 });
  const engine = await docker.run(["version", "--format", "{{json .Server}}"], { timeoutMs: 10_000 });
  if (dockerContext.stdout.trim() !== "orbstack") throw new Error("Qualification requires the OrbStack Docker context.");
  if (engine.exitCode !== 0) throw new Error("Could not read the OrbStack Engine version.");
  const imageIds = await Promise.all([
    imageId(docker, `nulltrace-isolation-tools:${imageTagSuffix}`),
    imageId(docker, `nulltrace-isolation-proxy:${imageTagSuffix}`),
    imageId(docker, `nulltrace-isolation-network-init:${imageTagSuffix}`),
  ]);
  const [workerImage, proxyImage, initializerImage] = imageIds;
  const workerArch = await docker.run([
    "image", "inspect", workerImage, "--format", "{{.Os}}/{{.Architecture}}",
  ], { timeoutMs: 10_000 });
  if (workerArch.stdout.trim() !== platform) throw new Error("Qualified worker image is not Linux ARM64.");
  dockerHostAddress = await resolveDockerHost(docker, workerImage);

  const instanceId = "curl-qualification-client";
  const clientToken = randomBytes(32).toString("hex");
  const adminToken = randomBytes(32).toString("hex");
  brokerKey = randomBytes(32);
  const journalPath = join(brokerDirectory, "receipts.sqlite");
  const brokerDatabase = new Database(journalPath, { create: true });
  provisionExecutionBrokerJournal(brokerDatabase, installationId, brokerKey);
  new ExecutionAuthorizationLedgerRepository(brokerDatabase, brokerKey, []);
  brokerDatabase.close();
  await chmod(journalPath, 0o600);
  const manifest = {
    version: 1,
    installationId,
    instanceId,
    dockerExecutable,
    images: { worker: workerImage, proxy: proxyImage, initializer: initializerImage },
    trustedNonPublicMappings: { [dockerHostAddress]: [dockerHostAddress] },
  };
  for (const [name, contents] of [
    ["broker-daemon.json", JSON.stringify(manifest)],
    ["broker.key", brokerKey],
    ["client.token", Buffer.from(clientToken)],
    ["admin.token", Buffer.from(adminToken)],
  ] as const) {
    const path = join(brokerDirectory, name);
    await writeFile(path, contents, { mode: 0o600 });
    await chmod(path, 0o600);
  }
  brokerProcess = Bun.spawn([
    process.execPath,
    fileURLToPath(new URL("./run-broker.ts", import.meta.url)),
    brokerDirectory,
  ], {
    stdin: "ignore",
    stdout: "pipe",
    stderr: "pipe",
    env: { PATH: process.env.PATH ?? "/usr/local/bin:/usr/bin:/bin", HOME: brokerDirectory },
  });
  if (!brokerProcess.stdout || typeof brokerProcess.stdout === "number" ||
    !brokerProcess.stderr || typeof brokerProcess.stderr === "number") {
    throw new Error("Broker diagnostics streams are unavailable.");
  }
  brokerOutputTasks = [
    captureSanitizedStream(brokerProcess.stdout, brokerStdout),
    captureSanitizedStream(brokerProcess.stderr, brokerStderr),
  ];
  await waitForSockets(brokerDirectory);

  await check("forbidden receiver is observable from a disposable worker image", async () => {
    const probe = await docker.run([
      "run", "--rm", "--read-only", "--cap-drop", "ALL", "--security-opt", "no-new-privileges:true",
      "--user", "65532:65532", workerImage, "curl", "--fail", "--silent", "--show-error", "--max-time", "5",
      `http://${dockerHostAddress}:${forbidden.port}/reachability-control`,
    ], { timeoutMs: 15_000 });
    expect(probe.exitCode === 0 && forbiddenRequests.length === 1 &&
      forbiddenRequests[0] === "/reachability-control",
    "Disposable worker could not reach the controlled forbidden receiver.");
    forbiddenRequests.length = 0;
    return "disposable worker reached forbidden receiver once before the isolated redirect check; counter reset";
  });

  const origin = `http://${dockerHostAddress}:${approved.port}`;
  const sessionTarget = `${origin}/`;
  const target = sessionRepository.findOrCreateTarget(sessionTarget, sessionTarget);
  const session = sessionRepository.createSession(target.id);
  const curlTool = toolRegistry.curl;
  const commandRunnerCalls = { run: 0, stop: 0 };
  const commandRunner = {
    async run() {
      commandRunnerCalls.run += 1;
      throw new Error("Host command runner must not execute cURL.");
    },
    stop() {
      commandRunnerCalls.stop += 1;
    },
  };
  const runner = new ToolRunnerService(commandRunner, undefined, sessionRepository);
  const output: string[] = [];
  const system: string[] = [];
  let completedRunId: string | null = null;

  await check("registered application cURL persists a redacted successful request", async () => {
    const brokerBefore = await readBrokerJournalProgress(join(brokerDirectory, "receipts.sqlite"));
    let toolData = curlTool.createInitialToolData(sessionTarget) as CurlToolData;
    toolData = {
      ...toolData,
      form: {
        ...toolData.form,
        method: "POST",
        targetUrl: `${origin}/request?token=query-canary`,
        headers: "X-Qualification: header-canary",
        body: "body-canary",
      },
    };
    const command = curlTool.buildGeneratedCommand(toolData);
    await runner.run({
      sessionId: session.id,
      toolName: "curl",
      command,
      commandSource: "generated",
      toolModule: curlTool as ToolModule,
      targetUrl: sessionTarget,
      toolData,
      onRunStarted: (id) => { completedRunId = id; },
      onStdoutLines: (lines) => output.push(...lines),
      onStderrLines: (lines) => output.push(...lines),
      onSystemLines: (lines) => system.push(...lines),
      onRunFinished: () => undefined,
    });
    const detail = completedRunId ? sessionRepository.getToolRunWithLogs(completedRunId) : null;
    const brokerAfter = await readBrokerJournalProgress(join(brokerDirectory, "receipts.sqlite"));
    if (completedRunId === null || approvedRequests.length !== 1) {
      throw new Error(`Application request did not reach approved receiver; ${formatRunDiagnostic(detail)}; ${formatBrokerProgress(brokerBefore, brokerAfter)}; daemon=${formatDiagnostic(brokerStdout.concat(brokerStderr).join(" | "))}; callbacks=${formatDiagnostic(system.concat(output).slice(-12).join(" | "))}`);
    }
    const received = approvedRequests[0]!;
    expect(received.method === "POST" && received.path === "/request" && received.query === "?token=query-canary",
      "Application cURL did not preserve the intended POST URL and query.");
    expect(received.header === "header-canary" && received.body === "body-canary",
      "Application cURL did not preserve its request header and body.");
    expect(detail?.status === "success" && detail.exitCode === 0, "Successful cURL status was not persisted.");
    expect(detail?.command.includes("query-canary") === false && detail?.command.includes("header-canary") === false &&
      detail?.command.includes("body-canary") === false, "Persisted command history exposed a request canary.");
    expect(output.join("\n").includes("echo [redacted] [redacted] [redacted]"),
      "Application output did not show the redacted echoed response.");
    expect(/^\[http 200\] \d+(?:\.\d+)?s /m.test(output.join("\n")),
      "Application output omitted the HTTP status and timing footer.");
    expect(!output.join("\n").includes("query-canary") && !output.join("\n").includes("header-canary") &&
      !output.join("\n").includes("body-canary"), "Application output exposed a request canary.");
    const logs = detail?.logs.map((line) => line.line).join("\n") ?? "";
    expect(/^\[http 200\] \d+(?:\.\d+)?s /m.test(logs),
      "Persisted output logs omitted the HTTP status and timing footer.");
    expect(!logs.includes("query-canary") && !logs.includes("header-canary") && !logs.includes("body-canary"),
      "Persisted output logs exposed a request canary.");
    const summaries = detail?.artifacts.filter((artifact) => artifact.artifactType === "output_summary") ?? [];
    expect(summaries.length === 1, "Successful cURL did not persist exactly one output summary.");
    expect(detail?.artifacts.length === 1, "Successful cURL persisted an unexpected artifact.");
    expect(sessionRepository.listToolRuns(session.id, "curl").some((run) => run.id === completedRunId),
      "Successful cURL was missing from persisted run history.");
    const summaryPayload = summaries[0]?.payload;
    const summary = JSON.stringify(summaryPayload);
    expect(!summary.includes("query-canary") && !summary.includes("header-canary") && !summary.includes("body-canary"),
      "Persisted output summary exposed a request canary.");
    expect(typeof summaryPayload === "object" && summaryPayload !== null && !Array.isArray(summaryPayload),
      "Persisted output summary has an invalid payload.");
    const summaryFields = summaryPayload as Record<string, unknown>;
    expect(summaryFields.lineCount === detail?.logs.length &&
      summaryFields.firstLine === (detail?.logs[0]?.line ?? null) &&
      summaryFields.lastLine === (detail?.logs.at(-1)?.line ?? null),
    "Persisted output summary does not match the durable logs.");
    expect(sessionDatabase.query<{ count: number }, [string]>(
      "SELECT COUNT(*) AS count FROM session_findings WHERE session_id = ?",
    ).get(session.id)?.count === 0, "The cURL application qualification created a finding.");
    expect(commandRunnerCalls.run === 0, "cURL fell back to the host command runner.");
    return "real registry and ToolRunnerService; receiver got POST, query, header and body; persisted success/history/log/output summary redacted all canaries; host runner calls 0";
  });

  await check("missing broker fails closed without a host command fallback", async () => {
    const originalBrokerDirectory = process.env.NULLTRACE_EXECUTION_BROKER_DIR;
    const beforeRequests = approvedRequests.length;
    const brokerBefore = await readBrokerJournalProgress(join(brokerDirectory, "receipts.sqlite"));
    let missingBrokerRunId: string | null = null;
    const initialToolData = curlTool.createInitialToolData(sessionTarget);
    const toolData = {
      ...initialToolData,
      form: { ...initialToolData.form, targetUrl: `${origin}/missing-broker` },
    } as CurlToolData;
    try {
      delete process.env.NULLTRACE_EXECUTION_BROKER_DIR;
      await runner.run({
        sessionId: session.id,
        toolName: "curl",
        command: curlTool.buildGeneratedCommand(toolData),
        commandSource: "generated",
        toolModule: curlTool as ToolModule,
        targetUrl: sessionTarget,
        toolData,
        onRunStarted: (id) => { missingBrokerRunId = id; },
        onStdoutLines: (lines) => output.push(...lines),
        onStderrLines: (lines) => output.push(...lines),
        onSystemLines: (lines) => system.push(...lines),
      });
    } finally {
      if (originalBrokerDirectory === undefined) delete process.env.NULLTRACE_EXECUTION_BROKER_DIR;
      else process.env.NULLTRACE_EXECUTION_BROKER_DIR = originalBrokerDirectory;
    }
    const detail = missingBrokerRunId ? sessionRepository.getToolRunWithLogs(missingBrokerRunId) : null;
    expect(approvedRequests.length === beforeRequests, "Request reached the approved receiver without a broker.");
    if (detail?.status !== "error" || !detail.logs.some((entry) => entry.line.includes("NULLTRACE_EXECUTION_BROKER_DIR"))) {
      const brokerAfter = await readBrokerJournalProgress(join(brokerDirectory, "receipts.sqlite"));
      throw new Error(`Unset broker directory did not persist its setup guidance; ${formatRunDiagnostic(detail)}; ${formatBrokerProgress(brokerBefore, brokerAfter)}`);
    }
    expect(commandRunnerCalls.run === 0 && commandRunnerCalls.stop === 0,
      "Missing broker caused a cURL host command fallback.");
    return "missing broker setup guidance persisted; receiver count unchanged; host runner calls 0";
  });

  await check("cross-origin redirect is denied before the forbidden receiver", async () => {
    const before = forbiddenRequests.length;
    const beforeRedirectRequests = approvedRequests.filter((request) => request.path === "/redirect").length;
    const brokerBefore = await readBrokerJournalProgress(join(brokerDirectory, "receipts.sqlite"));
    let redirectRunId: string | null = null;
    const initialToolData = curlTool.createInitialToolData(sessionTarget);
    const toolData = {
      ...initialToolData,
      form: {
        ...initialToolData.form,
        targetUrl: `${origin}/redirect`,
      },
    } as CurlToolData;
    const command = curlTool.buildGeneratedCommand(toolData);
    await runner.run({
      sessionId: session.id,
      toolName: "curl",
      command,
      commandSource: "generated",
      toolModule: curlTool as ToolModule,
      targetUrl: sessionTarget,
      toolData,
      onRunStarted: (id) => { redirectRunId = id; },
      onStdoutLines: (lines) => output.push(...lines),
      onStderrLines: (lines) => output.push(...lines),
      onSystemLines: (lines) => system.push(...lines),
    });
    const run = redirectRunId ? sessionRepository.getToolRunWithLogs(redirectRunId) : null;
    const afterRedirectRequests = approvedRequests.filter((request) => request.path === "/redirect").length;
    const brokerAfter = await readBrokerJournalProgress(join(brokerDirectory, "receipts.sqlite"));
    expect(afterRedirectRequests === beforeRedirectRequests + 1,
      `Redirect fixture was not reached exactly once; ${formatRunDiagnostic(run)}; ${formatBrokerProgress(brokerBefore, brokerAfter)}`);
    expect(forbiddenRequests.length === before, "Forbidden redirect receiver observed a request.");
    expect(run?.status === "error" && run.exitCode === 2 &&
      run.logs.some((entry) => entry.line.includes("cURL worker failed validation or execution")),
    `Known redirect fixture did not produce the worker's safe rejection marker; ${formatRunDiagnostic(run)}`);
    const detail = run;
    expect(commandRunnerCalls.run === 0, "Redirect cURL fell back to the host command runner.");
    expect(detail?.artifacts.filter((artifact) => artifact.artifactType === "output_summary").length === 1,
      "Failed cURL did not persist its output summary.");
    return "approved redirect receiver got one request; worker exited 2 before forbidden receiver; error history and output summary persisted";
  });

  await check("cancellation confirms cleanup through the application runner", async () => {
    const beforeHeldRequests = heldRequestCount;
    const brokerBefore = await readBrokerJournalProgress(join(brokerDirectory, "receipts.sqlite"));
    let releaseHeldRequest: (() => void) | null = null;
    const held = new Promise<void>((resolve) => { releaseHeldRequest = resolve; });
    heldRequest = releaseHeldRequest;
    const initialToolData = curlTool.createInitialToolData(sessionTarget);
    const toolData = {
      ...initialToolData,
      form: {
        ...initialToolData.form,
        targetUrl: `${origin}/hold`,
      },
    } as CurlToolData;
    const command = curlTool.buildGeneratedCommand(toolData);
    let cancelledRunId: string | null = null;
    const cancelledOutput: string[] = [];
    const running = runner.run({
      sessionId: session.id,
      toolName: "curl",
      command,
      commandSource: "generated",
      toolModule: curlTool as ToolModule,
      targetUrl: sessionTarget,
      toolData,
      onRunStarted: (id) => { cancelledRunId = id; },
      onStdoutLines: (lines) => cancelledOutput.push(...lines),
      onStderrLines: (lines) => cancelledOutput.push(...lines),
      onSystemLines: (lines) => cancelledOutput.push(...lines),
    });
    try {
      const reached = await Promise.race([
        held.then(() => true),
        Bun.sleep(10_000).then(() => false),
      ]);
      if (!reached) {
        runner.stop();
        await running;
        const detail = cancelledRunId ? sessionRepository.getToolRunWithLogs(cancelledRunId) : null;
        const brokerAfter = await readBrokerJournalProgress(join(brokerDirectory, "receipts.sqlite"));
        throw new Error(`Held fixture was not reached; requests=${heldRequestCount - beforeHeldRequests}; ${formatRunDiagnostic(detail)}; ${formatBrokerProgress(brokerBefore, brokerAfter)}; daemon=${formatDiagnostic(brokerStdout.concat(brokerStderr).join(" | "))}; callbacks=${formatDiagnostic(cancelledOutput.slice(-12).join(" | "))}`);
      }
      expect(heldRequestCount === beforeHeldRequests + 1, "Held fixture request count was not exactly one.");
      runner.stop();
      await running;
      expect(cancelledRunId !== null, "Cancelled cURL run ID was not persisted.");
      const detail = sessionRepository.getToolRunWithLogs(cancelledRunId!);
      expect(detail?.status === "cancelled", "Application did not persist the cancelled run state.");
      expect(cancelledOutput.some((line) => line.includes("cancelled")),
        "Application did not report cancellation through its run callbacks.");
      expect(commandRunnerCalls.run === 0 && commandRunnerCalls.stop === 0,
        "cURL cancellation reached the host command runner.");
      const activeContainers = await docker.run([
        "ps", "-aq", "--filter", `label=nulltrace.installation=${installationId}`,
      ], { timeoutMs: 10_000 });
      const activeNetworks = await docker.run([
        "network", "ls", "-q", "--filter", `label=nulltrace.installation=${installationId}`,
      ], { timeoutMs: 10_000 });
      expect(activeContainers.exitCode === 0 && activeContainers.stdout.trim() === "",
        "Execution containers remain after application cancellation.");
      expect(activeNetworks.exitCode === 0 && activeNetworks.stdout.trim() === "",
        "Execution networks remain after application cancellation.");
      return "live request cancelled by ToolRunnerService; broker cleanup confirmed; container and network counts 0";
    } finally {
      heldRequest = null;
      runner.stop();
      await running.catch(() => undefined);
    }
  });

  const persistedRunCount = sessionRepository.listToolRuns(session.id, "curl").length;
  closeSessionDatabase?.();
  closeSessionDatabase = null;
  const appFiles = await readDirectoryFiles(appDataDirectory);
  const appDataText = appFiles.map((file) => file.toString("utf8")).join("\n");
  expect(!appDataText.includes("query-canary") && !appDataText.includes("header-canary") &&
    !appDataText.includes("body-canary"), "Application data contains a raw cURL request canary.");
  expect(forbiddenRequests.length === 0, "Forbidden receiver observed a request during qualification.");
  expect(commandRunnerCalls.run === 0 && commandRunnerCalls.stop === 0, "Host command runner was called.");
  checks.push({ name: "application data and host execution boundary contain no request canaries", passed: true,
    detail: "temporary SQLite application data has no request canaries; host command runner calls 0" });
  if (brokerProcess) {
    await stopBrokerProcess(brokerProcess);
    brokerProcess = null;
  }
  expect(!(await lstat(join(brokerDirectory, "broker.sock")).catch(() => null)) &&
    !(await lstat(join(brokerDirectory, "broker-admin.sock")).catch(() => null)),
  "Broker sockets remain after broker shutdown.");
  const finalContainers = await docker.run([
    "ps", "-aq", "--filter", `label=nulltrace.installation=${installationId}`,
  ], { timeoutMs: 10_000 });
  const finalNetworks = await docker.run([
    "network", "ls", "-q", "--filter", `label=nulltrace.installation=${installationId}`,
  ], { timeoutMs: 10_000 });
  expect(finalContainers.exitCode === 0 && finalContainers.stdout.trim() === "",
    "Application qualification left installation-owned containers behind.");
  expect(finalNetworks.exitCode === 0 && finalNetworks.stdout.trim() === "",
    "Application qualification left installation-owned networks behind.");
  if (checks.some((checkResult) => !checkResult.passed)) throw new Error("Application cURL qualification failed.");

  const engineDetails = JSON.parse(engine.stdout);
  const evidence = {
    checkedAt: new Date().toISOString(),
    platform,
    engine: {
      version: engineDetails.Version,
      apiVersion: engineDetails.ApiVersion,
      os: engineDetails.Os,
      architecture: engineDetails.Arch,
      kernelVersion: engineDetails.KernelVersion,
    },
    imageTags: {
      worker: `nulltrace-isolation-tools:${imageTagSuffix}`,
      proxy: `nulltrace-isolation-proxy:${imageTagSuffix}`,
      initializer: `nulltrace-isolation-network-init:${imageTagSuffix}`,
    },
    imageIds,
    checks,
    receiverCounts: { approved: approvedRequests.length, forbidden: forbiddenRequests.length },
    persistence: { runs: persistedRunCount, canariesFound: false },
    cleanup: { installationContainers: 0, installationNetworks: 0 },
    hostRunnerCalls: commandRunnerCalls,
  };
  await Bun.write(new URL("./evidence/orbstack-curl-application-arm64.json", import.meta.url), `${JSON.stringify(evidence, null, 2)}\n`);
  console.log(`Passed ${checks.length} cURL application qualification checks on ${platform}.`);

} finally {
  approved.stop(true);
  forbidden.stop(true);
  if (brokerProcess) {
    brokerProcess.kill("SIGTERM");
    const timeout = setTimeout(() => brokerProcess?.kill("SIGKILL"), 10_000);
    try {
      const exitCode = await brokerProcess.exited;
      if (exitCode !== 0) preserveBrokerDirectory = true;
    }
    finally { clearTimeout(timeout); }
  }
  await Promise.allSettled(brokerOutputTasks);
  let cleanupError: string | null = null;
  if (dockerService) {
    const [containers, networks] = await Promise.all([
      dockerService.run(["ps", "-aq", "--filter", `label=nulltrace.installation=${installationId}`], { timeoutMs: 10_000 }),
      dockerService.run(["network", "ls", "-q", "--filter", `label=nulltrace.installation=${installationId}`], { timeoutMs: 10_000 }),
    ]).catch(() => {
      preserveBrokerDirectory = true;
      cleanupError = "Could not confirm final installation resource inventory; private broker journal was preserved.";
      return [null, null] as const;
    });
    if ((containers && (containers.exitCode !== 0 || containers.stdout.trim())) ||
      (networks && (networks.exitCode !== 0 || networks.stdout.trim()))) {
      preserveBrokerDirectory = true;
      cleanupError = "Installation-owned containers or networks remain; private broker journal was preserved.";
    }
  } else {
    preserveBrokerDirectory = true;
  }
  try { closeSessionDatabase?.(); }
  catch {
    preserveBrokerDirectory = true;
    cleanupError = "Could not close the temporary application database cleanly.";
  }
  brokerKey?.fill(0);
  await rm(appDataDirectory, { recursive: true, force: true });
  if (!preserveBrokerDirectory) await rm(brokerDirectory, { recursive: true, force: true });
  if (cleanupError) throw new Error(cleanupError);
}

async function check(name: string, operation: () => Promise<string>): Promise<void> {
  try {
    const detail = await operation();
    checks.push({ name, passed: true, detail });
    console.log(`PASS ${name}: ${detail}`);
  } catch (error) {
    const detail = error instanceof Error ? error.message : String(error);
    checks.push({ name, passed: false, detail });
    console.error(`FAIL ${name}: ${detail}`);
  }
}

async function imageId(docker: DockerCommandService, tag: string): Promise<string> {
  const result = await docker.run(["image", "inspect", tag, "--format", "{{.Id}}"], { timeoutMs: 10_000 });
  const value = result.stdout.trim();
  expect(result.exitCode === 0 && /^sha256:[a-f0-9]{64}$/.test(value), `Missing immutable qualified image ${tag}.`);
  return value;
}

async function resolveDockerHost(
  docker: DockerCommandService,
  image: string,
): Promise<string> {
  const result = await docker.run([
    "run", "--rm", "--read-only", "--cap-drop", "ALL", "--security-opt", "no-new-privileges:true",
    "--user", "65532:65532", image, "getent", "ahostsv4", "host.docker.internal",
  ], { timeoutMs: 15_000 });
  const address = result.stdout.trim().split(/\s+/)[0] ?? "";
  expect(result.exitCode === 0 && /^(?:\d{1,3}\.){3}\d{1,3}$/.test(address), "Docker host mapping is unavailable.");
  return address;
}

async function waitForSockets(directory: string): Promise<void> {
  for (let attempt = 0; attempt < 100; attempt += 1) {
    const socket = await lstat(join(directory, "broker.sock")).catch(() => null);
    const adminSocket = await lstat(join(directory, "broker-admin.sock")).catch(() => null);
    if (socket?.isSocket() && adminSocket?.isSocket()) return;
    await Bun.sleep(100);
  }
  throw new Error("Dedicated broker process did not open both private sockets.");
}

async function stopBrokerProcess(child: ReturnType<typeof Bun.spawn>): Promise<void> {
  child.kill("SIGTERM");
  const timeout = setTimeout(() => child.kill("SIGKILL"), 10_000);
  let exitCode: number;
  try { exitCode = await child.exited; }
  finally { clearTimeout(timeout); }
  expect(exitCode === 0, "Broker process did not exit cleanly after cleanup.");
}

async function readDirectoryFiles(directory: string): Promise<Buffer[]> {
  const output: Buffer[] = [];
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    const path = join(directory, entry.name);
    if (entry.isDirectory()) output.push(...await readDirectoryFiles(path));
    else if (entry.isFile()) output.push(await readFile(path));
  }
  return output;
}

interface BrokerJournalProgress {
  grants: number;
  sealedInputs: number;
  receiptStatuses: Record<string, number>;
  outcomes: number;
}

async function readBrokerJournalProgress(path: string): Promise<BrokerJournalProgress> {
  const database = new Database(path, { readonly: true, create: false });
  try {
    const grants = database.query<{ count: number }, []>(
      "SELECT COUNT(*) AS count FROM execution_authorizations",
    ).get()?.count ?? 0;
    const sealedInputs = database.query<{ count: number }, []>(
      "SELECT COUNT(*) AS count FROM execution_receipts WHERE sealed_inputs <> '{}'",
    ).get()?.count ?? 0;
    const receiptStatuses = Object.fromEntries(database.query<
      { status: string; count: number }, []
    >("SELECT status, COUNT(*) AS count FROM execution_receipts GROUP BY status").all()
      .map(({ status, count }) => [status, count]));
    const outcomes = database.query<{ count: number }, []>(
      "SELECT COUNT(*) AS count FROM execution_outcomes",
    ).get()?.count ?? 0;
    return { grants, sealedInputs, receiptStatuses, outcomes };
  } finally {
    database.close();
  }
}

function formatBrokerProgress(before: BrokerJournalProgress, after: BrokerJournalProgress): string {
  return `brokerStages=${JSON.stringify({
    grants: `${before.grants}->${after.grants}`,
    reservedReceipts: `${sumValues(before.receiptStatuses)}->${sumValues(after.receiptStatuses)}`,
    sealedInputs: `${before.sealedInputs}->${after.sealedInputs}`,
    receiptStatuses: after.receiptStatuses,
    controlOutcomes: `${before.outcomes}->${after.outcomes}`,
  })}`;
}

function sumValues(values: Record<string, number>): number {
  return Object.values(values).reduce((total, count) => total + count, 0);
}

function formatRunDiagnostic(
  detail: { status: string; exitCode: number | null; logs: Array<{ line: string }> } | null,
): string {
  if (!detail) return "run=absent";
  const lines = detail.logs.slice(-10).map(({ line }) => formatDiagnostic(line));
  return `run=${JSON.stringify({ status: detail.status, exitCode: detail.exitCode, logs: lines })}`;
}

function formatDiagnostic(value: string): string {
  return value
    .replaceAll("query-canary", "[query-canary]")
    .replaceAll("header-canary", "[header-canary]")
    .replaceAll("body-canary", "[body-canary]")
    .replace(/https?:\/\/[^\s"'`]+/gi, "[url]")
    .replace(/\/Users\/[^\s"'`]+/g, "[private-path]")
    .replace(/\/(?:private\/)?tmp\/[^\s"'`]+/g, "[private-path]")
    .replace(/\b[a-f0-9]{64}\b/gi, "[credential]")
    .replace(/\b(?:\d{1,3}\.){3}\d{1,3}(?::\d+)?\b/g, "[host]")
    .slice(0, 512);
}

async function captureSanitizedStream(stream: ReadableStream<Uint8Array>, output: string[]): Promise<void> {
  const reader = stream.getReader();
  const decoder = new TextDecoder();
  let pending = "";
  let totalBytes = 0;
  try {
    while (true) {
      const { value, done } = await reader.read();
      if (done) break;
      totalBytes += value.byteLength;
      if (totalBytes > 16_384) continue;
      pending += decoder.decode(value, { stream: true });
      const lines = pending.split(/\r?\n/);
      pending = lines.pop() ?? "";
      for (const line of lines) {
        if (output.length < 20) output.push(formatDiagnostic(line));
      }
    }
    pending += decoder.decode();
    if (pending && output.length < 20) output.push(formatDiagnostic(pending));
  } finally {
    await reader.cancel().catch(() => {});
    reader.releaseLock();
  }
}

function expect(condition: boolean, message: string): asserts condition {
  if (!condition) throw new Error(message);
}
