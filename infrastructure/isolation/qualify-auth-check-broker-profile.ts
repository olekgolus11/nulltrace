import { randomBytes, randomUUID } from "node:crypto";
import { chmod, mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Database } from "bun:sqlite";
import { DockerCommandService } from "../../src/features/execution/services/docker-command.service";
import { DockerCommandAdapter } from "../../src/features/execution/types/http-execution-network.types";
import { ExecutionBrokerService } from "../../src/features/execution/services/execution-broker.service";
import { ExecutionReceiptRepository } from "../../src/features/execution/services/execution-receipt.repository";
import { ExecutionBrokerLockService } from "../../src/features/execution/services/execution-broker-lock.service";
import { ExecutionAuthCheckOutputSanitizerService } from "../../src/features/execution/services/execution-auth-check-output-sanitizer.service";
import { toExecutionOutcome } from "../../src/features/execution/services/execution-outcome.helpers";
import { HttpExecutionNetworkService } from "../../src/features/execution/services/http-execution-network.service";
import { HttpExecutionResolverService } from "../../src/features/execution/services/http-execution-resolver.service";
import { authCheckExecutionProfile, createAuthCheckExecutionPlan } from "../../src/features/execution/services/auth-check-execution-profile.helpers";
import { HttpExecutionSupervisorService } from "../../src/features/execution/services/http-execution-supervisor.service";
import { HttpExecutionSupervisedNetwork } from "../../src/features/execution/types/http-execution-supervisor.types";
import { ExecutionCredentialBinding, ExecutionPrincipal } from "../../src/features/execution/types/execution-broker.types";
import { createIsolationBuildArguments } from "./isolation-build.helpers";
import release from "./release.lock.json";

const platform = Bun.argv[2];
if (platform !== "linux/arm64" && platform !== "linux/amd64") {
  throw new Error("Usage: TMPDIR=/tmp bun run infrastructure/isolation/qualify-auth-check-broker-profile.ts <linux/arm64|linux/amd64>");
}
const architecture = platform.slice(6);
const setupResources: {
  receiverA: Bun.Server<undefined> | null;
  receiverB: Bun.Server<undefined> | null;
  directory: string | null;
  database: Database | null;
  receipts: ExecutionReceiptRepository | null;
  ownershipLock: ExecutionBrokerLockService | null;
  supervisor: HttpExecutionSupervisorService | null;
  cleaned: boolean;
} = { receiverA: null, receiverB: null, directory: null, database: null, receipts: null, ownershipLock: null, supervisor: null, cleaned: false };
const dockerCommands: string[] = [];
const dockerMetadata: string[] = [];
const proxyDecisions: string[] = [];
const dockerService = new DockerCommandService("docker", 8 * 1024 * 1024);
const docker: DockerCommandAdapter = {
  async run(args, options) {
    dockerCommands.push(args.join(" "));
    const result = await dockerService.run(args, options);
    if (args[0] === "run" && args.includes("--name")) {
      const nameIndex = args.indexOf("--name");
      const name = args[nameIndex + 1];
      if (name) {
        const inspect = await dockerService.run(["inspect", "--format", "{{json .Config.Cmd}} {{json .Config.Env}} {{json .Args}}", name], { timeoutMs: 10_000 });
        if (inspect.exitCode === 0) dockerMetadata.push(inspect.stdout);
      }
    }
    return result;
  },
};
const temporaryToolsTag = `nulltrace-auth-check-qualification:${randomUUID().slice(0, 12)}`;
const proxyImage = await imageId(`nulltrace-isolation-proxy:${release.resolvedAt}-${architecture}`);
const initializerImage = await imageId(`nulltrace-isolation-network-init:${release.resolvedAt}-${architecture}`);
const buildArguments = createIsolationBuildArguments("tools", platform);
const tagIndex = buildArguments.indexOf("--tag");
if (tagIndex < 0) throw new Error("The pinned tools image build arguments are invalid.");
buildArguments[tagIndex + 1] = temporaryToolsTag;
const build = await docker.run(buildArguments, { timeoutMs: 30 * 60_000, outputLimitBytes: 8 * 1024 * 1024 });
if (build.exitCode !== 0) {
  const partialImage = await dockerService.run(["image", "inspect", temporaryToolsTag], { timeoutMs: 10_000 });
  if (partialImage.exitCode === 0) {
    const removedPartial = await dockerService.run(["image", "rm", temporaryToolsTag], { timeoutMs: 30_000 });
    if (removedPartial.exitCode !== 0) throw new Error("Failed image build left a temporary image that could not be removed.");
  }
  throw new Error(`Temporary Auth Check qualification image build failed: ${build.stderr.slice(-2_000)}`);
}
let workerImage: string;
let hostAddress: string;
try {
  workerImage = await imageId(temporaryToolsTag);
  hostAddress = await resolveDockerHost(workerImage);
} catch (error) {
  const removeImage = await dockerService.run(["image", "rm", temporaryToolsTag], { timeoutMs: 30_000 });
  if (removeImage.exitCode !== 0) throw new Error("Auth Check image preflight failed and its temporary image could not be removed.");
  throw error;
}
try {
  const canary = `auth-check-${randomBytes(18).toString("hex")}`;
  const receiverAEvents: Array<{ path: string; authenticated: boolean; canaryMatched: boolean }> = [];
  let receiverBCount = 0;
  const holdControl: { started: () => void; releases: Array<() => void> } = { started: () => {}, releases: [] };
  const heldRequest = new Promise<void>((resolve) => { holdControl.started = resolve; });
  const receiverB = Bun.serve({
    hostname: "127.0.0.1",
    port: 0,
    fetch() {
      receiverBCount += 1;
      return new Response("destination receiver\n");
    },
  });
  setupResources.receiverB = receiverB;
  const receiverA = Bun.serve({
    hostname: "127.0.0.1",
    port: 0,
    async fetch(request) {
      const url = new URL(request.url);
      const authorization = request.headers.get("authorization");
      receiverAEvents.push({ path: url.pathname, authenticated: authorization !== null, canaryMatched: authorization === `Bearer ${canary}` });
      if (url.pathname === "/cross-origin") {
        return new Response(null, { status: 302, headers: { location: `http://${hostAddress}:${receiverB.port}/outside` } });
      }
        if (url.pathname === "/hold" && authorization === `Bearer ${canary}`) {
          holdControl.started();
          return new Promise<Response>((resolve) => { holdControl.releases.push(() => resolve(new Response("released\n"))); });
        }
      if (authorization === `Bearer ${canary}`) {
        return new Response("<html><head><title>Authorized</title></head><body>private content</body></html>", {
          status: 200,
          headers: { "content-type": "text/html" },
        });
      }
        return new Response('<html><head><title>Sign in</title></head><body><form><input type="password"></form></body></html>', {
        status: 401,
        headers: { "content-type": "text/html" },
      });
    },
  });
  setupResources.receiverA = receiverA;

  const directory = await mkdtemp(join(tmpdir(), "nulltrace-auth-check-qualification-"));
  setupResources.directory = directory;
  await chmod(directory, 0o700);
  const key = randomBytes(32);
  const database = new Database(join(directory, "receipts.sqlite"), { create: true });
  setupResources.database = database;
  const receipts = new ExecutionReceiptRepository(database, key);
  setupResources.receipts = receipts;
  const principal: ExecutionPrincipal = { installationId: "auth-check-qualification", instanceId: randomUUID() };
  let currentGeneration = 9;
  const binding: ExecutionCredentialBinding = { scopeId: "qualification-scope", generation: currentGeneration };
  const authority = {
    resolveBinding(_principal: ExecutionPrincipal, _authorizationId: string, _plan: ReturnType<typeof createAuthCheckExecutionPlan>) {
      return { ...binding };
    },
    isCurrent(_principal: ExecutionPrincipal, candidate: ExecutionCredentialBinding) {
      return candidate.scopeId === binding.scopeId && candidate.generation === currentGeneration;
    },
  };
  const profiles = [structuredClone(authCheckExecutionProfile)];
  const planByAuthorizationId = new Map<string, ReturnType<typeof createAuthCheckExecutionPlan>>();
  const ownershipLock = new ExecutionBrokerLockService(join(directory, "broker-lock.sqlite"));
  setupResources.ownershipLock = ownershipLock;
  const host = new HttpExecutionNetworkService(docker, {
    images: { worker: workerImage, proxy: proxyImage, initializer: initializerImage },
    installationId: principal.installationId,
    ownershipLock,
    trustedNonPublicMappings: { [hostAddress]: [hostAddress] },
    commandTimeoutMs: 70_000,
    setupTimeoutMs: 30_000,
    cleanupTimeoutMs: 30_000,
  });
  const resolver = new HttpExecutionResolverService({ trustedNonPublicMappings: { [hostAddress]: [hostAddress] } });
  const supervisedNetwork: HttpExecutionSupervisedNetwork = {
    async run(...args) {
      const result = await host.run(...args);
      proxyDecisions.push(...result.evidence.proxyDecisions);
      return result;
    },
  };
  const supervisor = new HttpExecutionSupervisorService(supervisedNetwork, resolver, {
    leaseMs: 30_000,
    cleanupWaitMs: 60_000,
    secretOutputSanitizer: new ExecutionAuthCheckOutputSanitizerService(),
    onSettled(run) { receipts.recordOutcome(toExecutionOutcome(run)); },
  });
  setupResources.supervisor = supervisor;
  const broker = new ExecutionBrokerService(receipts, {
    profiles,
    credentialAuthority: authority,
    authCheckOutputProfileId: authCheckExecutionProfile.id,
    now: Date.now,
    readAuthorization(_principal, authorizationId) {
      const approvedPlan = planByAuthorizationId.get(authorizationId);
      return approvedPlan ? { principal, plan: approvedPlan, expiresAt: Date.now() + 120_000 } : null;
    },
    runtime: supervisor,
  });
  const origin = `http://${hostAddress}:${receiverA.port}`;
  const outcomes: Record<string, string | number | boolean> = {};
  let teardownVerified = false;
  let temporaryImageRemoved = false;

  try {
    const positiveControlOrigin = `http://${hostAddress}:${receiverB.port}`;
    const positiveControl = await host.run(
      await resolver.resolve("qualification-b-positive-control", [positiveControlOrigin]),
      authCheckExecutionProfile.maximumLimits,
      "curl",
      ["--silent", "--show-error", "--fail", "--max-time", "5", `${positiveControlOrigin}/positive-control`],
    );
    expect(positiveControl.command.exitCode === 0 && positiveControl.command.stdout === "destination receiver\n" && receiverBCount === 1,
      "The disposable B receiver positive control was unreachable.");
    receiverBCount = 0;
    const bControlResult = await dockerService.run(["version", "--format", "{{.Server.Version}}"], { timeoutMs: 10_000 });
    expect(bControlResult.exitCode === 0 && bControlResult.stdout.trim().length > 0, "The active container engine version is unavailable.");

    const stalePlan = registerPlan("stale-config", origin, "/check", planByAuthorizationId);
    broker.prepare(principal, stalePlan);
    const beforeStaleConfig = receiverAEvents.length;
    await rejects(() => broker.putInput(principal, stalePlan.executionId, "auth-check-config", config(origin, "/check", canary, currentGeneration - 1)));
    outcomes.staleConfigReceiverDelta = receiverAEvents.length - beforeStaleConfig;
    expect(outcomes.staleConfigReceiverDelta === 0, "A stale configuration generated an outbound request.");
    await broker.cancel(principal, stalePlan.executionId);

    const allowedPlan = registerPlan("allowed-origin", origin, "/check", planByAuthorizationId);
    broker.prepare(principal, allowedPlan);
    await broker.putInput(principal, allowedPlan.executionId, "auth-check-config", config(origin, "/check", canary, currentGeneration));
    await broker.start(principal, allowedPlan.executionId);
    await waitUntilClosed(allowedPlan.executionId, receipts, broker, principal);
    const allowedResult = broker.readEvents(principal, allowedPlan.executionId, -1).events;
    expect(allowedResult.length === 1 && allowedResult[0]?.stream === "stdout", "The successful Auth Check result was not released as one frame.");
    const parsedAllowed = JSON.parse(allowedResult[0]!.line) as { status?: string; isProceedAllowed?: boolean };
    expect(parsedAllowed.status === "verified" && parsedAllowed.isProceedAllowed === true, "The approved synthetic authentication comparison was not verified.");
    expect(receiverAEvents.some((event) => event.path === "/check" && !event.authenticated) &&
      receiverAEvents.some((event) => event.path === "/check" && event.authenticated && event.canaryMatched),
    "The approved origin did not receive both public and authenticated legs with the in-memory canary.");
    outcomes.allowedUnauthenticatedLeg = true;
    outcomes.allowedAuthenticatedLeg = true;
    outcomes.allowedResultFrameCount = allowedResult.length;

    const redirectPlan = registerPlan("cross-origin-redirect", origin, "/cross-origin", planByAuthorizationId);
    broker.prepare(principal, redirectPlan);
    await broker.putInput(principal, redirectPlan.executionId, "auth-check-config", config(origin, "/cross-origin", canary, currentGeneration));
    const receiverBBefore = receiverBCount;
    await broker.start(principal, redirectPlan.executionId);
    await waitUntilClosed(redirectPlan.executionId, receipts, broker, principal);
    const redirectResult = broker.readEvents(principal, redirectPlan.executionId, -1).events;
    expect(receiverBCount === receiverBBefore, "The worker contacted the off-origin B receiver.");
    expect(redirectResult.length === 1 && JSON.parse(redirectResult[0]!.line).status === "failed",
      "The cross-origin redirect result was not safely released as failed.");
    outcomes.offOriginBReceiverCount = receiverBCount - receiverBBefore;
    outcomes.crossOriginResultFrameCount = redirectResult.length;

    const revokePlan = registerPlan("active-revocation", origin, "/hold", planByAuthorizationId);
    broker.prepare(principal, revokePlan);
    await broker.putInput(principal, revokePlan.executionId, "auth-check-config", config(origin, "/hold", canary, currentGeneration));
    await broker.start(principal, revokePlan.executionId);
      await Promise.race([heldRequest, Bun.sleep(15_000).then(() => { throw new Error("Active revoke request did not reach receiver A."); })]);
      expect(receiverAEvents.some((event) => event.path === "/hold" && event.authenticated && event.canaryMatched),
        "The active revocation did not overlap the generated authenticated request.");
    currentGeneration += 1;
    await broker.revokeCredentialGeneration(principal, binding);
    await waitUntilClosed(revokePlan.executionId, receipts, broker, principal);
    expect(receipts.findOutcome(revokePlan.executionId)?.cleanup === "confirmed", "Revocation did not confirm durable runtime cleanup.");
    let revokedResultWithheld = false;
    try { broker.readEvents(principal, revokePlan.executionId, -1); } catch { revokedResultWithheld = true; }
    expect(revokedResultWithheld, "Revoked Auth Check output was released.");
    outcomes.activeRevocationCleanupConfirmed = true;
    outcomes.activeRevocationResultReleased = false;
    outcomes.activeAuthenticatedRequestObserved = true;
    outcomes.receiverARequestCount = receiverAEvents.length;
    expect(![...dockerCommands, ...dockerMetadata, ...proxyDecisions, ...allowedResult.map(({ line }) => line), ...redirectResult.map(({ line }) => line)]
      .some((value) => value.includes(canary)), "A generated canary appeared in Docker arguments, container metadata, proxy decisions, or retained result events.");
    outcomes.canaryScanPassed = true;

    await supervisor.shutdown();
    const containerInventory = await dockerService.run(["ps", "-aq", "--filter", `label=nulltrace.installation=${principal.installationId}`], { timeoutMs: 10_000 });
    const networkInventory = await dockerService.run(["network", "ls", "-q", "--filter", `label=nulltrace.installation=${principal.installationId}`], { timeoutMs: 10_000 });
    expect(containerInventory.exitCode === 0 && !containerInventory.stdout.trim(), "Qualification containers remain after Auth Check cleanup.");
    expect(networkInventory.exitCode === 0 && !networkInventory.stdout.trim(), "Qualification networks remain after Auth Check cleanup.");
    expect(!receipts.hasInterrupted() && receipts.listPending().length === 0, "A receipt remains interrupted or pending after qualification cleanup.");
    const imageIds = { worker: workerImage, proxy: proxyImage, initializer: initializerImage };
    teardownVerified = true;
    const removeImage = await dockerService.run(["image", "rm", temporaryToolsTag], { timeoutMs: 30_000 });
    expect(removeImage.exitCode === 0, "The temporary Auth Check qualification image could not be removed.");
    temporaryImageRemoved = true;
    outcomes.remainingContainers = 0;
    outcomes.remainingNetworks = 0;
    outcomes.temporaryImageRemoved = true;

    await writeQualificationEvidence({
      qualification: "auth-check-broker-profile",
      platform,
      generatedAt: new Date().toISOString(),
      engineVersion: bControlResult.stdout.trim(),
      imageIds,
      bReceiverPositiveControlCount: 1,
      observations: outcomes,
    });
    console.log("PASS Auth Check broker profile: approved legs, off-origin redirect blocked at B, stale config pre-send rejected, active revocation cleanup confirmed and output withheld");
  } finally {
    holdControl.releases.forEach((release) => release());
    let cleanupFailure: unknown = null;
    try {
      if (!teardownVerified) await supervisor.shutdown();
      const containerInventory = await dockerService.run(["ps", "-aq", "--filter", "label=nulltrace.installation=auth-check-qualification"], { timeoutMs: 10_000 });
      const networkInventory = await dockerService.run(["network", "ls", "-q", "--filter", "label=nulltrace.installation=auth-check-qualification"], { timeoutMs: 10_000 });
      if (containerInventory.exitCode !== 0 || containerInventory.stdout.trim() || networkInventory.exitCode !== 0 || networkInventory.stdout.trim()) {
        throw new Error("Auth Check qualification teardown is uncertain; retaining its journal and temporary image for recovery.");
      }
      if (receipts.hasInterrupted() || receipts.listPending().length > 0) {
        throw new Error("Auth Check qualification has an unsettled receipt; retaining its journal and temporary image for recovery.");
      }
      teardownVerified = true;
      if (!temporaryImageRemoved) {
        const removeImage = await dockerService.run(["image", "rm", temporaryToolsTag], { timeoutMs: 30_000 });
        if (removeImage.exitCode !== 0) throw new Error("The temporary Auth Check qualification image could not be removed.");
        temporaryImageRemoved = true;
      }
    } catch (error) {
      cleanupFailure = error;
    }
    await receiverA.stop(true);
    await receiverB.stop(true);
    ownershipLock.release();
    database.close();
    key.fill(0);
    if (teardownVerified && temporaryImageRemoved) {
      await rm(directory, { recursive: true, force: true });
    } else {
      console.error(`Auth Check qualification retained recovery material at ${directory} and image ${temporaryToolsTag}.`);
    }
    setupResources.cleaned = true;
    if (cleanupFailure) throw cleanupFailure;
  }
} catch (error) {
  if (!setupResources.cleaned) {
    let setupShutdownConfirmed = true;
    try { await setupResources.supervisor?.shutdown(); } catch { setupShutdownConfirmed = false; }
    for (const server of [setupResources.receiverA, setupResources.receiverB]) {
      if (server) await server.stop(true);
    }
    const containerInventory = await dockerService.run(["ps", "-aq", "--filter", "label=nulltrace.installation=auth-check-qualification"], { timeoutMs: 10_000 });
    const networkInventory = await dockerService.run(["network", "ls", "-q", "--filter", "label=nulltrace.installation=auth-check-qualification"], { timeoutMs: 10_000 });
    const receiptsSettled = setupResources.receipts === null ||
      (!setupResources.receipts.hasInterrupted() && setupResources.receipts.listPending().length === 0);
    const resourcesGone = setupShutdownConfirmed && receiptsSettled && containerInventory.exitCode === 0 && !containerInventory.stdout.trim() &&
      networkInventory.exitCode === 0 && !networkInventory.stdout.trim();
    setupResources.ownershipLock?.release();
    setupResources.database?.close();
    if (resourcesGone) {
      const removeImage = await dockerService.run(["image", "rm", temporaryToolsTag], { timeoutMs: 30_000 });
      if (removeImage.exitCode === 0 && setupResources.directory) {
        await rm(setupResources.directory, { recursive: true, force: true });
      } else {
        console.error(`Auth Check setup retained recovery material at ${setupResources.directory} and image ${temporaryToolsTag}.`);
      }
    } else {
      console.error(`Auth Check setup teardown is uncertain; retained recovery material at ${setupResources.directory} and image ${temporaryToolsTag}.`);
    }
  }
  throw error;
}

function registerPlan(
  name: string,
  exactOrigin: string,
  path: string,
  plansByAuthorizationId: Map<string, ReturnType<typeof createAuthCheckExecutionPlan>>,
) {
  const authorizationId = `auth-check-${name}`;
  const plan = createAuthCheckExecutionPlan({
    executionId: `qualification-${name}`,
    authorizationId,
    origin: exactOrigin,
  });
  plansByAuthorizationId.set(authorizationId, plan);
  return plan;
}

function config(exactOrigin: string, path: string, secret: string, contextVersion: number): Uint8Array {
  return new TextEncoder().encode(JSON.stringify({
    version: 1,
    operation: "auth-check",
    contextVersion,
    targetOrigin: exactOrigin,
    verificationUrl: `${exactOrigin}${path}`,
    authenticatedHeaders: [`Authorization: Bearer ${secret}`],
    requestTimeoutMs: 10_000,
    maximumResponseBytes: 128_000,
    maximumRedirectCount: 5,
    totalDeadlineMs: 30_000,
  }));
}

async function waitUntilClosed(
  executionId: string,
  receipts: ExecutionReceiptRepository,
  broker: ExecutionBrokerService,
  principal: ExecutionPrincipal,
): Promise<void> {
  for (let attempt = 0; attempt < 300; attempt += 1) {
    if (receipts.find(executionId)?.status === "closed") return;
    if (attempt > 0 && attempt % 100 === 0) broker.renewOwnership(principal, executionId);
    await Bun.sleep(100);
  }
  throw new Error(`Auth Check execution did not settle: ${executionId}`);
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

async function writeQualificationEvidence(value: unknown): Promise<void> {
  const file = new URL(`./evidence/orbstack-auth-check-broker-profile-${architecture}.json`, import.meta.url);
  await Bun.write(file, `${JSON.stringify(value, null, 2)}\n`);
}

async function rejects(operation: () => Promise<unknown>): Promise<void> {
  try { await operation(); } catch { return; }
  throw new Error("Expected the broker to reject the stale Auth Check configuration.");
}

function expect(condition: boolean, message: string): asserts condition {
  if (!condition) throw new Error(message);
}
