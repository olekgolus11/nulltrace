import { createHash, randomBytes, randomUUID } from "node:crypto";
import { chmod, lstat, mkdtemp, readdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { Database } from "bun:sqlite";
import { DockerCommandService } from "../../src/features/execution/services/docker-command.service";
import { ExecutionBrokerClient } from "../../src/features/execution/services/execution-broker-client.service";
import { ExecutionBrokerHostService } from "../../src/features/execution/services/execution-broker-host.service";
import { provisionExecutionBrokerJournal } from "../../src/features/execution/services/execution-broker-journal.helpers";
import { ExecutionBrokerLockService } from "../../src/features/execution/services/execution-broker-lock.service";
import { ExecutionEventBufferService } from "../../src/features/execution/services/execution-event-buffer.service";
import { HttpExecutionNetworkService } from "../../src/features/execution/services/http-execution-network.service";
import { createHttpExecutionNetworkPolicy } from "../../src/features/execution/services/http-execution-policy.helpers";
import { ExecutionLimits, ExecutionPlan, ExecutionProfile } from "../../src/features/execution/types/execution-plan.types";
import release from "./release.lock.json";

const platform = Bun.argv[2];
if (platform !== "linux/arm64" && platform !== "linux/amd64") {
  throw new Error("Usage: bun run infrastructure/isolation/qualify-http-network.ts <linux/arm64|linux/amd64>");
}
const architecture = platform.slice(6);
const suffix = `${release.resolvedAt}-${architecture}`;
const docker = new DockerCommandService("docker", 8 * 1024 * 1024);
const workerImage = await imageId(`nulltrace-isolation-tools:${suffix}`);
const proxyImage = await imageId(`nulltrace-isolation-proxy:${suffix}`);
const initializerImage = await imageId(`nulltrace-isolation-network-init:${suffix}`);
const hostAddress = await resolveDockerHost(workerImage);
const allowedEvents: Array<{ host: string | null; path: string }> = [];
const deniedEvents: Array<{ host: string | null; path: string }> = [];
const curlWorkerRequests: Array<{ method: string; path: string; header: string | null; body: string }> = [];
let onHeldRequest: (() => void) | null = null;
let deniedPort = 0;
let inputSecret: string | null = null;
const secretReceiverChecks: boolean[] = [];
const denied = Bun.serve({
  hostname: "127.0.0.1",
  port: 0,
  fetch(request) {
    deniedEvents.push({ host: request.headers.get("host"), path: new URL(request.url).pathname });
    return new Response("forbidden-server\n");
  },
});
deniedPort = denied.port!;
const allowed = Bun.serve({
  hostname: "127.0.0.1",
  port: 0,
  async fetch(request) {
    const url = new URL(request.url);
    allowedEvents.push({ host: request.headers.get("host"), path: url.pathname });
    if (url.pathname === "/hold") {
      onHeldRequest?.();
      return new Promise<Response>(() => undefined);
    }
    if (url.pathname === "/redirect") {
      return new Response(null, { status: 302, headers: { location: `http://forbidden.test:${deniedPort}/redirect-target` } });
    }
    if (url.pathname.startsWith("/curl-worker")) {
      curlWorkerRequests.push({
        method: request.method,
        path: url.pathname,
        header: request.headers.get("x-worker-test"),
        body: await request.text(),
      });
    }
    if (url.pathname === "/curl-worker-redirect") {
      return new Response(null, { status: 302, headers: { location: "/curl-worker-final?token=redirect-canary" } });
    }
    if (url.pathname === "/curl-worker-cross-redirect") {
      return new Response(null, { status: 302, headers: { location: `http://forbidden.test:${deniedPort}/curl-worker-blocked` } });
    }
    if (url.pathname === "/curl-worker-get") return new Response("echo query-canary header-canary\n");
    if (url.pathname === "/curl-worker-post") return new Response("echo body-canary\n");
    if (url.pathname === "/curl-worker-final") return new Response("echo redirect-canary\n");
    if (url.pathname === "/curl-worker-large") return new Response("z".repeat(2 * 1024 * 1024));
    if (url.pathname === "/secret-input") {
      const matched = inputSecret !== null && request.headers.get("authorization") === `Bearer ${inputSecret}`;
      secretReceiverChecks.push(matched);
      return new Response(matched ? "input-ok\n" : "input-rejected\n", { status: matched ? 200 : 401 });
    }
    if (url.pathname === "/large") return new Response("x".repeat(2 * 1024 * 1024));
    return new Response("approved-server\n");
  },
});
const allowedPort = allowed.port!;
const limits: ExecutionLimits = {
  timeoutMs: 15_000,
  memoryBytes: 128 * 1024 * 1024,
  cpuMilliCores: 500,
  processCount: 48,
  scratchBytes: 32 * 1024 * 1024,
  fileBytes: 8 * 1024 * 1024,
  outputBytes: 1024 * 1024,
};
const lockDirectory = await mkdtemp(join(tmpdir(), "nulltrace-http-qualification-"));
const ownershipLock = new ExecutionBrokerLockService(join(lockDirectory, "broker-lock.sqlite"));
const service = new HttpExecutionNetworkService(docker, {
  images: { worker: workerImage, proxy: proxyImage, initializer: initializerImage },
  installationId: "http-network-qualification",
  ownershipLock,
  trustedNonPublicMappings: { "approved.test": [hostAddress] },
  commandTimeoutMs: 20_000,
  setupTimeoutMs: 30_000,
  cleanupTimeoutMs: 30_000,
});
const checks: Array<{ name: string; passed: boolean; detail: string }> = [];
const orphanNetwork = `nt-qualification-orphan-${randomUUID().slice(0, 8)}`;

try {
  const orphan = await docker.run([
    "network", "create", "--label", "nulltrace.installation=http-network-qualification", orphanNetwork,
  ], { timeoutMs: 10_000 });
  if (orphan.exitCode !== 0) throw new Error("Could not create a controlled orphan network for recovery qualification.");
  const allowedOrigin = `http://approved.test:${allowedPort}`;
  const allowedPolicy = (executionId: string) => createHttpExecutionNetworkPolicy(executionId, [allowedOrigin], [{
    origin: allowedOrigin,
    hostname: "approved.test",
    address: hostAddress,
    family: 4,
    port: allowedPort,
  }], { "approved.test": [hostAddress] });
  await check("allowed exact-origin request", async () => {
    const before = allowedEvents.length;
    const result = await service.run(allowedPolicy("qualification-allowed"), limits, "curl", [
      "--silent", "--show-error", "--fail", "--max-time", "5", `${allowedOrigin}/allowed`,
    ]);
    expect(result.command.exitCode === 0 && result.command.stdout === "approved-server\n", "Approved response was not returned.");
    expect(allowedEvents.length === before + 1, "Approved server did not receive exactly one request.");
    expect(allowedEvents.at(-1)?.host === `approved.test:${allowedPort}`, "The approved Host header changed.");
    expect(result.evidence.cleanupConfirmed, "Allowed environment cleanup was not confirmed.");
    const orphanAfter = await docker.run(["network", "inspect", orphanNetwork], { timeoutMs: 10_000 });
    expect(orphanAfter.exitCode !== 0, "A labeled orphan network survived startup reconciliation.");
    return `receiver count ${allowedEvents.length}; cleanup confirmed`;
  });
  await check("bounded worker events drain without stopping the approved request", async () => {
    const events = new ExecutionEventBufferService("qualification-events", 1024);
    const result = await service.run(allowedPolicy("qualification-events"), limits, "curl", [
      "--silent", "--show-error", "--fail", "--max-time", "10", `${allowedOrigin}/large`,
    ], undefined, (stream, chunk) => events.append(stream, chunk));
    events.finish();
    expect(result.command.exitCode === 0, "A large approved response stopped the worker.");
    expect(result.command.stdout === "" && result.command.stderr === "", "Raw worker output was retained.");
    expect(events.read(-1).events.some((event) => event.stream === "system" && event.line.includes("truncated")), "Output truncation was not reported.");
    expect(result.evidence.cleanupConfirmed, "Streaming run cleanup was not confirmed.");
    return "approved large response completed; bounded events and cleanup confirmed";
  });
  await check("worker resource limits are effective inside the container", async () => {
    const probe = [
      "import json, os, resource",
      "def read(name):",
      "    with open('/sys/fs/cgroup/' + name) as value: return value.read().strip()",
      "print(json.dumps({'uid': os.getuid(), 'memory': read('memory.max'), 'pids': read('pids.max'),",
      "    'cpu': read('cpu.max'), 'file': resource.getrlimit(resource.RLIMIT_FSIZE)[0]}))",
    ].join("\n");
    const result = await service.run(allowedPolicy("qualification-limits"), limits, "python3", ["-c", probe]);
    expect(result.command.exitCode === 0 && result.evidence.cleanupConfirmed, "Resource probe did not finish cleanly.");
    const measured: unknown = JSON.parse(result.command.stdout);
    expect(typeof measured === "object" && measured !== null && !Array.isArray(measured), "Invalid resource probe result.");
    const values = measured as Record<string, unknown>;
    const cpu = typeof values.cpu === "string" ? values.cpu.split(" ").map(Number) : [];
    expect(values.uid === 65532, "Worker does not run as the unprivileged account.");
    expect(values.memory === String(limits.memoryBytes), "Worker memory cgroup limit differs from the approved plan.");
    expect(values.pids === String(limits.processCount), "Worker PID cgroup limit differs from the approved plan.");
    expect(cpu.length === 2 && cpu[0]! > 0 && cpu[1]! > 0 &&
      cpu[0]! / cpu[1]! <= limits.cpuMilliCores / 1000, "Worker CPU quota exceeds the approved plan.");
    expect(values.file === limits.fileBytes, "Worker file-size limit differs from the approved plan.");
    return `uid ${values.uid}; memory ${values.memory}; pids ${values.pids}; cpu ${values.cpu}; file ${values.file}`;
  });
  await check("worker memory limit stops an oversized allocation", async () => {
    const probe = [
      "import json, subprocess, sys",
      "program = \"chunks = []\\nfor _ in range(256):\\n chunk = bytearray(1024 * 1024)\\n for offset in range(0, len(chunk), 4096): chunk[offset] = 1\\n chunks.append(chunk)\"",
      "def oom_kills():",
      "    with open('/sys/fs/cgroup/memory.events') as events:",
      "        return int(dict(line.split() for line in events)['oom_kill'])",
      "before = oom_kills()",
      "child = subprocess.run([sys.executable, '-c', program], stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)",
      "delta = oom_kills() - before",
      "print(json.dumps({'childStatus': child.returncode, 'oomKillDelta': delta}))",
      "if child.returncode != -9 or delta < 1: raise SystemExit(1)",
    ].join("\n");
    const result = await service.run(allowedPolicy("qualification-memory"), limits, "python3", ["-c", probe]);
    expect(result.command.exitCode === 0, "Oversized child allocation was not killed by the configured memory limit.");
    expect(result.evidence.cleanupConfirmed, "Memory-limit run cleanup was not confirmed.");
    const measured: unknown = JSON.parse(result.command.stdout);
    expect(typeof measured === "object" && measured !== null && !Array.isArray(measured), "Invalid memory-limit probe result.");
    const values = measured as Record<string, unknown>;
    expect(values.childStatus === -9 && typeof values.oomKillDelta === "number" && values.oomKillDelta >= 1,
      "Memory denial was not confirmed by an OOM kill event.");
    return `oversized child received SIGKILL; cgroup OOM kill delta ${values.oomKillDelta}; cleanup confirmed`;
  });
  await check("worker process limit rejects excess child processes", async () => {
    const probe = [
      "import errno, os, signal, time",
      "children = []",
      "denied = 0",
      "try:",
      "    for _ in range(128):",
      "        try:",
      "            pid = os.fork()",
      "        except OSError as error:",
      "            denied = error.errno",
      "            break",
      "        if pid == 0:",
      "            time.sleep(30)",
      "            os._exit(0)",
      "        children.append(pid)",
      "finally:",
      "    for pid in children:",
      "        try: os.kill(pid, signal.SIGKILL)",
      "        except ProcessLookupError: pass",
      "    for pid in children:",
      "        try: os.waitpid(pid, 0)",
      "        except ChildProcessError: pass",
      "print(f'{denied} {len(children)}')",
      "if denied != errno.EAGAIN or len(children) >= 128: raise SystemExit(1)",
    ].join("\n");
    const result = await service.run(allowedPolicy("qualification-pids"), limits, "python3", ["-c", probe]);
    expect(result.command.exitCode === 0, "Worker was able to exceed the configured process limit.");
    expect(result.evidence.cleanupConfirmed, "Process-limit run cleanup was not confirmed.");
    const [errnoValue, countValue] = result.command.stdout.trim().split(" ").map(Number);
    expect(errnoValue === 11 && Number.isInteger(countValue) && countValue > 0 && countValue < limits.processCount,
      "The worker process limit did not reject fork with EAGAIN before reaching the probe safety bound.");
    return `fork rejected after ${countValue} children; cleanup confirmed`;
  });
  await check("worker file-size limit rejects oversized files", async () => {
    const probe = [
      "import os",
      "import signal",
      "path = '/work/oversized.bin'",
      "signal.signal(signal.SIGXFSZ, signal.SIG_IGN)",
      "blocked = False",
      "total = 0",
      "with open(path, 'wb', buffering=0) as output:",
      "    try:",
      "        while total <= 9 * 1024 * 1024:",
      "            total += output.write(b'x' * 65536)",
      "    except OSError:",
      "        blocked = True",
      "size = os.path.getsize(path)",
      "print(f'{size} {int(blocked)}')",
      "if not blocked or size > 8 * 1024 * 1024: raise SystemExit(1)",
    ].join("\n");
    const result = await service.run(allowedPolicy("qualification-file-size"), limits, "python3", ["-c", probe]);
    expect(result.command.exitCode === 0, "Worker created a file larger than its configured file-size limit.");
    expect(result.evidence.cleanupConfirmed, "File-size run cleanup was not confirmed.");
    const [sizeValue, blockedValue] = result.command.stdout.trim().split(" ").map(Number);
    const size = sizeValue ?? Number.NaN;
    expect(Number.isSafeInteger(size) && size <= limits.fileBytes && blockedValue === 1,
      "The worker file-size limit did not reject a write beyond the approved maximum.");
    return `largest file ${size} bytes under ${limits.fileBytes} byte limit; cleanup confirmed`;
  });
  await check("worker deadline kills the command and confirms cleanup", async () => {
    const shortLimits = { ...limits, timeoutMs: 1_000 };
    let timedOut = false;
    try {
      await service.run(allowedPolicy("qualification-deadline"), shortLimits, "sleep", ["5"]);
    } catch (error) {
      timedOut = error instanceof Error && error.message.includes("timed out");
    }
    expect(timedOut, "Worker command did not stop at the execution deadline.");
    const containers = await docker.run(["ps", "-aq", "--filter", "label=nulltrace.execution"], { timeoutMs: 10_000 });
    const networks = await docker.run(["network", "ls", "-q", "--filter", "label=nulltrace.execution"], { timeoutMs: 10_000 });
    expect(containers.exitCode === 0 && !containers.stdout.trim(), "Execution containers remain after timeout.");
    expect(networks.exitCode === 0 && !networks.stdout.trim(), "Execution networks remain after timeout.");
    return "worker timed out; container and network counts 0";
  });
  await check("private broker socket delivers an approved isolated request", async () => {
    const directory = await mkdtemp(join(tmpdir(), "nulltrace-broker-qualification-"));
    await chmod(directory, 0o700);
    const key = randomBytes(32);
    const journal = join(directory, "receipts.sqlite");
    const database = new Database(journal, { create: true });
    provisionExecutionBrokerJournal(database, "broker-qualification", key);
    database.close();
    await chmod(journal, 0o600);
    const token = randomBytes(32).toString("hex");
    const principal = { installationId: "broker-qualification", instanceId: "qualification-client" };
    const profile: ExecutionProfile = {
      id: "public-input-qualification", tool: "qualification", mode: "public", executableIds: ["python3"],
      inputs: [{ id: "auth", kind: "secret", maximumBytes: 64 }], maximumLimits: limits,
    };
    const secret = Buffer.from(randomBytes(32).toString("base64url"), "ascii");
    const secretCanary = Buffer.from(secret);
    inputSecret = secret.toString("ascii");
    const verifyInputAndRequest = "import pathlib,stat,sys,urllib.request; p=pathlib.Path(sys.argv[1]); b=p.read_bytes(); assert stat.S_IMODE(p.stat().st_mode)==0o600 and len(b)==43; req=urllib.request.Request(sys.argv[2],headers={'Authorization':'Bearer '+b.decode('ascii')}); urllib.request.urlopen(req,timeout=5).read(); print('worker-input-confirmed')";
    const plan: ExecutionPlan = {
      version: 1, executionId: "broker-input-qualification-run", authorizationId: "approved-run",
      profileId: profile.id, tool: "qualification", mode: "public",
      invocation: { executableId: "python3", argv: ["-c", verifyInputAndRequest, "/work/input-auth", `${allowedOrigin}/secret-input`] },
      origins: [allowedOrigin], inputs: profile.inputs, limits,
    };
    const brokerHost = new ExecutionBrokerHostService({
      directory, installationId: principal.installationId, hmacKey: key,
      identities: [{ token, principal }], profiles: [profile],
      readAuthorization: () => ({ principal, plan, expiresAt: Date.now() + 60_000 }),
      images: { worker: workerImage, proxy: proxyImage, initializer: initializerImage },
      trustedNonPublicMappings: { "approved.test": [hostAddress] }, docker, leaseMs: 10_000,
      async lookup(hostname) {
        if (hostname !== "approved.test") throw new Error("Qualification resolver received an unexpected hostname.");
        return [{ address: hostAddress, family: 4 }];
      },
    });
    const before = allowedEvents.length;
    try {
      const unix = await brokerHost.start();
      const client = new ExecutionBrokerClient((request) => fetch(request, { unix }), token);
      expect((await client.prepare(plan)).status === "prepared", "Broker did not prepare the approved plan.");
      expect((await client.putInput(plan.executionId, "auth", secret)).status === "prepared", "Broker did not seal the secret slot.");
      secret.fill(0);
      await client.start(plan.executionId);
      let receipt = await client.get(plan.executionId);
      for (let attempt = 0; attempt < 100 && receipt.status !== "closed"; attempt++) {
        await Bun.sleep(100);
        receipt = await client.get(plan.executionId);
      }
      expect(receipt.status === "closed" && receipt.cleanup === "confirmed", "Broker did not confirm cleanup.");
      expect(allowedEvents.length === before + 1, "Worker did not verify its private input before sending the approved request.");
      expect(allowedEvents.at(-1)?.path === "/secret-input", "Worker sent a request outside the approved qualification path.");
      expect(secretReceiverChecks.length === 1 && secretReceiverChecks[0], "Controlled receiver did not match the exact in-memory input canary.");
      const hostFiles = await readdir(directory);
      for (const name of hostFiles) {
        const content = await readFile(join(directory, name)).catch(() => Buffer.alloc(0));
        expect(!content.includes(secretCanary), "Input bytes appeared in a broker host file.");
      }
      const containers = await docker.run(["ps", "-aq", "--filter", "label=nulltrace.installation=broker-qualification"], { timeoutMs: 10_000 });
      const networks = await docker.run(["network", "ls", "-q", "--filter", "label=nulltrace.installation=broker-qualification"], { timeoutMs: 10_000 });
      expect(containers.exitCode === 0 && !containers.stdout.trim(), "Qualification left a container behind.");
      expect(networks.exitCode === 0 && !networks.stdout.trim(), "Qualification left a network behind.");
      return "broker putInput -> worker tmpfs read mode-0600 input; controlled receiver matched exact authorization canary; host files clean; containers/networks 0";
    } finally {
      await brokerHost.close();
      key.fill(0);
      secret.fill(0);
      secretCanary.fill(0);
      inputSecret = null;
      await rm(directory, { recursive: true, force: true });
    }
  });
  await check("public cURL worker preserves requests and blocks an unapproved redirect", async () => {
    const slot = { id: "curl-config", kind: "data" as const, maximumBytes: 2 * 1024 * 1024 };
    const runWorker = async (executionId: string, configuration: Record<string, unknown>) => {
      const bytes = new TextEncoder().encode(JSON.stringify(configuration));
      const output: string[] = [];
      try {
        return await service.run(
          allowedPolicy(executionId), limits, "bun", ["run", "/opt/nulltrace/workers/curl-worker.ts"], undefined,
          (_stream, chunk) => output.push(new TextDecoder().decode(chunk)),
          [{ slot, bytes }],
        ).then((result) => ({ result, output: output.join("") }));
      } finally { bytes.fill(0); }
    };
    const beforeAllowed = allowedEvents.length;
    const common = {
      version: 1, targetUrl: `${allowedOrigin}/curl-worker-get?token=query-canary`, exactOrigin: allowedOrigin,
      method: "GET", headers: ["X-Worker-Test: header-canary"], bodyOperations: [],
      maximumRedirectCount: 5, maximumResponseBytes: 2 * 1024 * 1024, timeoutSeconds: 10,
    };
    const get = await runWorker("qualification-curl-worker-get", common);
    expect(get.result.command.exitCode === 0, "cURL worker GET failed.");
    expect(curlWorkerRequests.at(-1)?.method === "GET" && curlWorkerRequests.at(-1)?.header === "header-canary",
      "cURL worker did not preserve the GET method and inline header.");
    expect(get.output.includes("echo [redacted] [redacted]") && !get.output.includes("query-canary") && !get.output.includes("header-canary"),
      "cURL worker output did not redact echoed query and header values.");
    const post = await runWorker("qualification-curl-worker-post", {
      ...common, targetUrl: `${allowedOrigin}/curl-worker-post`, method: "POST",
      bodyOperations: [{ kind: "data-raw", value: "body-" }, { kind: "data-raw", value: "canary" }],
    });
    expect(post.result.command.exitCode === 0, "cURL worker POST failed.");
    expect(curlWorkerRequests.at(-1)?.method === "POST" && curlWorkerRequests.at(-1)?.body === "body-&canary",
      "cURL worker did not preserve ordered body operations.");
    expect(post.output.includes("echo [redacted]") && !post.output.includes("body-canary"), "cURL worker output did not redact echoed body values.");
    const redirected = await runWorker("qualification-curl-worker-redirect", {
      ...common, targetUrl: `${allowedOrigin}/curl-worker-redirect`,
    });
    expect(redirected.result.command.exitCode === 0 && curlWorkerRequests.some((request) => request.path === "/curl-worker-final"),
      "cURL worker did not follow the approved same-origin redirect.");
    expect(redirected.output.includes("echo [redacted]") && !redirected.output.includes("redirect-canary"),
      "cURL worker output did not redact an echoed redirect query value.");
    const beforeDenied = deniedEvents.length;
    const crossRedirect = await runWorker("qualification-curl-worker-cross-redirect", {
      ...common, targetUrl: `${allowedOrigin}/curl-worker-cross-redirect`,
    });
    expect(crossRedirect.result.command.exitCode !== 0, "cURL worker accepted a cross-origin redirect.");
    expect(deniedEvents.length === beforeDenied, "Forbidden redirect receiver observed a cURL worker request.");
    const forgedOrigin = `http://forbidden.test:${deniedPort}`;
    const forgedScope = await runWorker("qualification-curl-worker-forged-input-origin", {
      ...common, targetUrl: `${forgedOrigin}/forged-scope`, exactOrigin: forgedOrigin,
    });
    expect(forgedScope.output.includes("[http 403]"), "Broker network policy did not reject the forged input origin with HTTP 403.");
    expect(deniedEvents.length === beforeDenied, "Broker network policy allowed a forged input origin to reach the receiver.");
    expect(allowedEvents.length === beforeAllowed + 5, "cURL worker request count did not match the expected GET, POST, redirects.");
    return "GET, POST headers and ordered body, same-origin redirect passed; cross-origin redirect and forged input origin receiver count 0; output redacted request canaries; tmpfs cleaned";
  });
  await check("dedicated broker process delivers an approved isolated request", async () => {
    const directory = await mkdtemp(join(tmpdir(), "nulltrace-daemon-qualification-"));
    await chmod(directory, 0o700);
    const key = randomBytes(32);
    const token = randomBytes(32).toString("hex");
    const adminToken = randomBytes(32).toString("hex");
    const journal = join(directory, "receipts.sqlite");
    const database = new Database(journal, { create: true });
    provisionExecutionBrokerJournal(database, "daemon-qualification", key);
    database.close();
    await chmod(journal, 0o600);
    const targetOrigin = `http://${hostAddress}:${allowedPort}`;
    const requestConfig = Buffer.from(JSON.stringify({
      version: 1, targetUrl: `${targetOrigin}/curl-worker-get?token=query-canary`, exactOrigin: targetOrigin,
      method: "GET", headers: ["X-Worker-Test: header-canary"], bodyOperations: [],
      maximumRedirectCount: 5, maximumResponseBytes: 2 * 1024 * 1024, timeoutSeconds: 5,
    }));
    const plan: ExecutionPlan = {
      version: 1, executionId: "daemon-qualification-run", authorizationId: "approved-run",
      profileId: "public-curl-worker-v1", tool: "curl", mode: "public-worker",
      invocation: { executableId: "bun", argv: ["run", "/opt/nulltrace/workers/curl-worker.ts"] },
      origins: [targetOrigin], inputs: [{ id: "curl-config", kind: "data", maximumBytes: 2 * 1024 * 1024 }], limits,
    };
    const executable = Bun.which("docker");
    if (!executable) throw new Error("Docker executable is unavailable.");
    const manifest = {
      version: 1, installationId: "daemon-qualification", instanceId: "qualification-client",
      dockerExecutable: executable,
      images: { worker: workerImage, proxy: proxyImage, initializer: initializerImage },
      trustedNonPublicMappings: { [hostAddress]: [hostAddress] },
    };
    for (const [name, content] of [
      ["broker-daemon.json", JSON.stringify(manifest)],
      ["broker.key", key],
      ["client.token", token],
      ["admin.token", adminToken],
    ] as const) {
      const path = join(directory, name);
      await writeFile(path, content, { mode: 0o600 });
      await chmod(path, 0o600);
    }
    const script = fileURLToPath(new URL("./run-broker.ts", import.meta.url));
    const child = Bun.spawn([process.execPath, script, directory], {
      stdin: "ignore", stdout: "pipe", stderr: "pipe",
      env: { PATH: process.env.PATH ?? "/usr/local/bin:/usr/bin:/bin", HOME: directory },
    });
    const socket = join(directory, "broker.sock");
    const adminSocket = join(directory, "broker-admin.sock");
    const before = allowedEvents.length;
    try {
      let ready = false;
      for (let attempt = 0; attempt < 100; attempt++) {
        if ((await lstat(socket).catch(() => null))?.isSocket() &&
          (await lstat(adminSocket).catch(() => null))?.isSocket()) { ready = true; break; }
        await Bun.sleep(100);
      }
      expect(ready, "Dedicated broker did not open both private sockets.");
      const administratorGrant = (grant: unknown, credential: string, unix: string) => fetch("http://localhost/v1/grants", {
        unix,
        method: "POST",
        headers: { authorization: `Bearer ${credential}`, "content-type": "application/json" },
        body: JSON.stringify(grant),
      });
      const grant = {
        principal: { installationId: "daemon-qualification", instanceId: "qualification-client" },
        plan,
        expiresAt: Date.now() + 60_000,
      };
      expect((await administratorGrant(grant, token, adminSocket)).status === 401,
        "Execution token was accepted on the grant socket.");
      expect((await administratorGrant(grant, adminToken, socket)).status === 401,
        "Administrator token was accepted on the execution socket.");
      expect((await administratorGrant({ ...grant, plan: { ...plan, origins: [...plan.origins, "https://outside.test"] } }, adminToken, adminSocket)).status === 400,
        "Administrator channel accepted multiple origins.");
      expect((await administratorGrant({ ...grant, plan: { ...plan, invocation: { ...plan.invocation, argv: [...plan.invocation.argv, "http://outside.test"] } } }, adminToken, adminSocket)).status === 400,
        "Administrator channel accepted an unqualified cURL argument.");
      expect((await administratorGrant(grant, adminToken, adminSocket)).status === 201,
        "Administrator channel rejected a valid structured grant.");
      expect((await administratorGrant(grant, adminToken, adminSocket)).status === 409,
        "Administrator channel accepted a duplicate authorization ID.");
      const client = new ExecutionBrokerClient((request) => fetch(request, { unix: socket }), token);
      expect((await client.prepare(plan)).status === "prepared", "Dedicated broker rejected the approved plan.");
      expect((await client.putInput(plan.executionId, "curl-config", requestConfig)).status === "prepared",
        "Dedicated broker did not accept the declared cURL request slot.");
      requestConfig.fill(0);
      await client.start(plan.executionId);
      let receipt = await client.get(plan.executionId);
      for (let attempt = 0; attempt < 100 && receipt.status !== "closed"; attempt++) {
        await Bun.sleep(100);
        receipt = await client.get(plan.executionId);
      }
      expect(receipt.status === "closed" && receipt.cleanup === "confirmed", "Dedicated broker did not confirm cleanup.");
      const events = await client.readEvents(plan.executionId, -1);
      expect(events.events.some((event) => event.line === "echo [redacted] [redacted]"), "Dedicated broker did not return redacted cURL worker output.");
      expect(events.events.every((event) => !event.line.includes("query-canary") && !event.line.includes("header-canary")),
        "Dedicated broker exposed cURL request values in its output events.");
      expect(allowedEvents.length === before + 1, "Approved receiver did not observe the daemon request.");
      expect(curlWorkerRequests.at(-1)?.path === "/curl-worker-get" && curlWorkerRequests.at(-1)?.header === "header-canary",
        "Approved cURL request did not reach the controlled receiver with its inline header.");

      const largePlan = { ...plan, executionId: "daemon-qualification-large", authorizationId: "approved-large-run" };
      const largeInput = Buffer.from(JSON.stringify({
        version: 1, targetUrl: `${targetOrigin}/curl-worker-large`, exactOrigin: targetOrigin,
        method: "GET", headers: [], bodyOperations: [], maximumRedirectCount: 5,
        maximumResponseBytes: 2 * 1024 * 1024, timeoutSeconds: 10,
      }));
      const largeGrant = { ...grant, plan: largePlan };
      expect((await administratorGrant(largeGrant, adminToken, adminSocket)).status === 201,
        "Administrator channel rejected the bounded large-response grant.");
      expect((await client.prepare(largePlan)).status === "prepared", "Dedicated broker rejected the large-response plan.");
      expect((await client.putInput(largePlan.executionId, "curl-config", largeInput)).status === "prepared",
        "Dedicated broker did not accept the large-response cURL input.");
      largeInput.fill(0);
      await client.start(largePlan.executionId);
      receipt = await client.get(largePlan.executionId);
      for (let attempt = 0; attempt < 100 && receipt.status !== "closed"; attempt++) {
        await Bun.sleep(100);
        receipt = await client.get(largePlan.executionId);
      }
      const largeControl = await client.cancel(largePlan.executionId);
      expect(receipt.status === "closed" && receipt.cleanup === "confirmed" &&
        largeControl.status === "finished" && largeControl.cleanup === "confirmed" && largeControl.exitCode === 0,
        "Dedicated broker did not report successful cURL completion and confirmed cleanup after the large response.");
      const replayedLines: string[] = [];
      let cursor = -1;
      while (true) {
        const page = await client.readEvents(largePlan.executionId, cursor);
        replayedLines.push(...page.events.map((event) => event.line));
        if (!page.hasMore) break;
        cursor = page.nextSequence;
      }
      expect(/^\[http 200\] \d+(?:\.\d+)?s /.test(replayedLines.at(-1) ?? ""),
        "The replayed large response did not retain its HTTP status and timing footer.");
      expect(replayedLines.some((line) => line.includes("response body truncated by output limit")),
        "The large response did not produce an explicit bounded-preview marker.");
      expect(replayedLines.length < 2_000, "Large response exhausted the broker output-line budget.");
      expect(allowedEvents.length === before + 2 && curlWorkerRequests.at(-1)?.path === "/curl-worker-large",
        "Approved large response did not reach the controlled receiver exactly once.");
      const replayedLineBytes = Buffer.byteLength(replayedLines.join("\n"));
      return `separate broker process; 2097152-byte response; ${replayedLines.length} replayed events (${replayedLineBytes} line bytes); HTTP 200 with timing; exit code 0; both runs cleaned up`;
    } finally {
      child.kill("SIGTERM");
      const timeout = setTimeout(() => child.kill("SIGKILL"), 10_000);
      try { await child.exited; }
      finally { clearTimeout(timeout); }
      key.fill(0);
      requestConfig.fill(0);
      await rm(directory, { recursive: true, force: true });
    }
  });
  await check("cross-origin redirect blocked before receiver", async () => {
    const before = deniedEvents.length;
    const result = await service.run(allowedPolicy("qualification-redirect"), limits, "curl", [
      "--silent", "--show-error", "--fail", "--location", "--max-time", "5", `${allowedOrigin}/redirect`,
    ]);
    expect(result.command.exitCode !== 0, "Cross-origin redirect succeeded.");
    expect(deniedEvents.length === before, "Forbidden redirect receiver observed a request.");
    expect(result.evidence.proxyDecisions.some((line) => line.includes("TCP_DENIED/403")), "Proxy deny decision was not recorded.");
    return `forbidden receiver count ${deniedEvents.length}; proxy deny recorded`;
  });
  await check("direct proxy bypass blocked before receiver", async () => {
    const before = deniedEvents.length;
    const result = await service.run(allowedPolicy("qualification-direct"), limits, "curl", [
      "--silent", "--show-error", "--noproxy", "*", "--connect-timeout", "2", "--max-time", "4",
      `http://${hostAddress}:${deniedPort}/direct`,
    ]);
    expect(result.command.exitCode !== 0, "Direct connection bypass succeeded.");
    expect(deniedEvents.length === before, "Forbidden direct receiver observed a request.");
    return `forbidden receiver count ${deniedEvents.length}`;
  });
  await check("worker DNS and unauthorized IPv6 are blocked", async () => {
    const dns = await service.run(allowedPolicy("qualification-dns"), limits, "curl", [
      "--silent", "--show-error", "--noproxy", "*", "--connect-timeout", "2", "--max-time", "4",
      `http://forbidden.test:${deniedPort}/dns`,
    ]);
    expect(dns.command.exitCode !== 0, "Unauthorized hostname resolved and connected directly.");
    const ipv6 = await service.run(allowedPolicy("qualification-ipv6"), limits, "curl", [
      "--silent", "--show-error", "--noproxy", "*", "--connect-timeout", "2", "--max-time", "4",
      "http://[2001:db8::55]:8080/ipv6",
    ]);
    expect(ipv6.command.exitCode !== 0, "Unauthorized IPv6 connection succeeded.");
    expect(deniedEvents.length === 0, "Forbidden receiver observed traffic during DNS/IPv6 checks.");
    return "both commands rejected; forbidden receiver count 0";
  });
  await check("cancellation removes a live worker and its networks", async () => {
    const owner = new AbortController();
    let acknowledgeHold: (() => void) | null = null;
    const held = new Promise<void>((resolve) => { acknowledgeHold = resolve; });
    onHeldRequest = acknowledgeHold;
    const running = service.run(allowedPolicy("qualification-cancel"), limits, "curl", [
      "--silent", "--show-error", "--max-time", "12", `${allowedOrigin}/hold`,
    ], owner.signal);
    try {
      await Promise.race([
        held,
        Bun.sleep(10_000).then(() => { throw new Error("Held request never reached the approved receiver."); }),
      ]);
      owner.abort();
      let cancelled = false;
      try { await running; } catch (error) {
        cancelled = error instanceof Error && error.message.includes("cancelled");
      }
      expect(cancelled, "Live worker did not report cancellation.");
      const containers = await docker.run(["ps", "-aq", "--filter", "label=nulltrace.execution"], { timeoutMs: 10_000 });
      const networks = await docker.run(["network", "ls", "-q", "--filter", "label=nulltrace.execution"], { timeoutMs: 10_000 });
      expect(containers.exitCode === 0 && !containers.stdout.trim(), "Execution containers remain after cancellation.");
      expect(networks.exitCode === 0 && !networks.stdout.trim(), "Execution networks remain after cancellation.");
      return "live request cancelled; container and network counts 0";
    } finally {
      owner.abort();
      onHeldRequest = null;
      await running.catch(() => undefined);
    }
  });
} finally {
  allowed.stop(true);
  denied.stop(true);
  await docker.run(["network", "rm", orphanNetwork], { timeoutMs: 10_000 }).catch(() => undefined);
  ownershipLock.release();
  await rm(lockDirectory, { recursive: true, force: true });
}

const runtime = await docker.run(["version", "--format", "{{json .Server}}"], { timeoutMs: 10_000 });
const evidence = {
  checkedAt: new Date().toISOString(),
  platform,
  runtime: JSON.parse(runtime.stdout),
  releaseLockSha256: createHash("sha256").update(Buffer.from(
    await Bun.file(new URL("./release.lock.json", import.meta.url)).arrayBuffer(),
  )).digest("hex"),
  images: { workerImage, proxyImage, initializerImage },
  hostMapping: { address: hostAddress, binding: "127.0.0.1", allowedPort, deniedPort },
  checks,
  receivers: { allowedEvents, deniedEvents },
};
await Bun.write(new URL(`./http-network-evidence-${architecture}.json`, import.meta.url), JSON.stringify(evidence, null, 2) + "\n");
if (checks.some((entry) => !entry.passed)) throw new Error("HTTP network qualification failed.");
console.log(`Passed ${checks.length} HTTP network checks on ${platform}.`);

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

async function imageId(tag: string): Promise<string> {
  const result = await docker.run(["image", "inspect", tag, "--format", "{{.Id}}"], { timeoutMs: 10_000 });
  const id = result.stdout.trim();
  if (result.exitCode !== 0 || !/^sha256:[a-f0-9]{64}$/.test(id)) throw new Error(`Missing qualified image: ${tag}`);
  return id;
}

async function resolveDockerHost(image: string): Promise<string> {
  const result = await docker.run([
    "run", "--rm", "--read-only", "--cap-drop", "ALL", "--security-opt", "no-new-privileges:true",
    "--user", "65532:65532", image, "getent", "ahostsv4", "host.docker.internal",
  ], { timeoutMs: 15_000 });
  const address = result.stdout.trim().split(/\s+/)[0] ?? "";
  if (result.exitCode !== 0 || !/^(?:\d{1,3}\.){3}\d{1,3}$/.test(address)) throw new Error("Docker host mapping is unavailable.");
  return address;
}

function expect(condition: boolean, message: string): asserts condition {
  if (!condition) throw new Error(message);
}
