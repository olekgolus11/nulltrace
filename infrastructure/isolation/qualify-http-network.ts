import { createHash, randomBytes, randomUUID } from "node:crypto";
import { chmod, lstat, mkdtemp, rm, writeFile } from "node:fs/promises";
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
let onHeldRequest: (() => void) | null = null;
let deniedPort = 0;
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
  fetch(request) {
    const url = new URL(request.url);
    allowedEvents.push({ host: request.headers.get("host"), path: url.pathname });
    if (url.pathname === "/hold") {
      onHeldRequest?.();
      return new Promise<Response>(() => undefined);
    }
    if (url.pathname === "/redirect") {
      return new Response(null, { status: 302, headers: { location: `http://forbidden.test:${deniedPort}/redirect-target` } });
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
      id: "public-curl-qualification", tool: "curl", mode: "public", executableIds: ["curl"],
      inputs: [], maximumLimits: limits,
    };
    const plan: ExecutionPlan = {
      version: 1, executionId: "broker-qualification-run", authorizationId: "approved-run",
      profileId: profile.id, tool: "curl", mode: "public",
      invocation: { executableId: "curl", argv: ["--silent", "--show-error", "--fail", "--max-time", "5", `${allowedOrigin}/broker`] },
      origins: [allowedOrigin], inputs: [], limits,
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
      await client.start(plan.executionId);
      let receipt = await client.get(plan.executionId);
      for (let attempt = 0; attempt < 100 && receipt.status !== "closed"; attempt++) {
        await Bun.sleep(100);
        receipt = await client.get(plan.executionId);
      }
      expect(receipt.status === "closed" && receipt.cleanup === "confirmed", "Broker did not confirm cleanup.");
      const events = await client.readEvents(plan.executionId, -1);
      expect(events.events.some((event) => event.line === "approved-server"), "Broker did not return the approved response event.");
      expect(allowedEvents.length === before + 1, "Approved receiver did not observe the broker request.");
      return "approved receiver count +1; broker event returned; cleanup confirmed";
    } finally {
      await brokerHost.close();
      key.fill(0);
      await rm(directory, { recursive: true, force: true });
    }
  });
  await check("dedicated broker process delivers an approved isolated request", async () => {
    const directory = await mkdtemp(join(tmpdir(), "nulltrace-daemon-qualification-"));
    await chmod(directory, 0o700);
    const key = randomBytes(32);
    const token = randomBytes(32).toString("hex");
    const journal = join(directory, "receipts.sqlite");
    const database = new Database(journal, { create: true });
    provisionExecutionBrokerJournal(database, "daemon-qualification", key);
    database.close();
    await chmod(journal, 0o600);
    const targetOrigin = `http://${hostAddress}:${allowedPort}`;
    const plan: ExecutionPlan = {
      version: 1, executionId: "daemon-qualification-run", authorizationId: "approved-run",
      profileId: "public-curl-v1", tool: "curl", mode: "public",
      invocation: { executableId: "curl", argv: ["--silent", "--show-error", "--fail", "--max-time", "5", `${targetOrigin}/daemon`] },
      origins: [targetOrigin], inputs: [], limits,
    };
    const executable = Bun.which("docker");
    if (!executable) throw new Error("Docker executable is unavailable.");
    const manifest = {
      version: 1, installationId: "daemon-qualification", instanceId: "qualification-client",
      dockerExecutable: executable,
      images: { worker: workerImage, proxy: proxyImage, initializer: initializerImage },
      trustedNonPublicMappings: { [hostAddress]: [hostAddress] },
      approvedPlan: plan, expiresAt: Date.now() + 60_000,
    };
    for (const [name, content] of [
      ["broker-daemon.json", JSON.stringify(manifest)],
      ["broker.key", key],
      ["client.token", token],
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
    const before = allowedEvents.length;
    try {
      let ready = false;
      for (let attempt = 0; attempt < 100; attempt++) {
        if ((await lstat(socket).catch(() => null))?.isSocket()) { ready = true; break; }
        await Bun.sleep(100);
      }
      expect(ready, "Dedicated broker did not open its private socket.");
      const client = new ExecutionBrokerClient((request) => fetch(request, { unix: socket }), token);
      expect((await client.prepare(plan)).status === "prepared", "Dedicated broker rejected the approved plan.");
      await client.start(plan.executionId);
      let receipt = await client.get(plan.executionId);
      for (let attempt = 0; attempt < 100 && receipt.status !== "closed"; attempt++) {
        await Bun.sleep(100);
        receipt = await client.get(plan.executionId);
      }
      expect(receipt.status === "closed" && receipt.cleanup === "confirmed", "Dedicated broker did not confirm cleanup.");
      const events = await client.readEvents(plan.executionId, -1);
      expect(events.events.some((event) => event.line === "approved-server"), "Dedicated broker did not return the approved response event.");
      expect(allowedEvents.length === before + 1, "Approved receiver did not observe the daemon request.");
      return "separate broker process; approved receiver count +1; cleanup confirmed";
    } finally {
      child.kill("SIGTERM");
      const timeout = setTimeout(() => child.kill("SIGKILL"), 10_000);
      try { await child.exited; }
      finally { clearTimeout(timeout); }
      key.fill(0);
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
