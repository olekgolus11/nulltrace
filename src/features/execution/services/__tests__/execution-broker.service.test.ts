import { afterEach, describe, expect, test } from "bun:test";
import { Database } from "bun:sqlite";
import { mkdtemp, readFile, rm, chmod } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { ExecutionBrokerService } from "../execution-broker.service";
import { ExecutionReceiptRepository } from "../execution-receipt.repository";
import { ExecutionAuthorizationLedgerRepository } from "../execution-authorization-ledger.repository";
import { ExecutionBrokerHttpService } from "../execution-broker-http.service";
import { ExecutionBrokerClient } from "../execution-broker-client.service";
import { parseExecutionPlan } from "../execution-plan.helpers";
import { ExecutionAuthorization, ExecutionBrokerOptions, ExecutionRuntimeAdapter } from "../../types/execution-broker.types";
import { ExecutionPlan, ExecutionProfile } from "../../types/execution-plan.types";
import { HttpExecutionSupervisorService } from "../http-execution-supervisor.service";
import { HttpExecutionNetworkPolicy } from "../../types/http-execution-network.types";
import { authCheckExecutionProfile, createAuthCheckExecutionPlan } from "../auth-check-execution-profile.helpers";

const principal = { installationId: "installation", instanceId: "instance" };
const token = "a".repeat(64);
const limits = { timeoutMs: 1000, memoryBytes: 1024, cpuMilliCores: 100, processCount: 4, scratchBytes: 1024, fileBytes: 512, outputBytes: 512 };
const profile: ExecutionProfile = {
  id: "http-test", tool: "curl", mode: "http", executableIds: ["curl"],
  inputs: [{ id: "credentials", kind: "secret", maximumBytes: 256 }], maximumLimits: limits,
};
const original: ExecutionPlan = {
  version: 1, executionId: "run-1", authorizationId: "approval-1", profileId: profile.id,
  tool: "curl", mode: "http", invocation: { executableId: "curl", argv: ["https://example.test"] },
  origins: ["https://example.test"], inputs: profile.inputs, limits,
};
const databases: Database[] = [];
afterEach(() => { databases.splice(0).forEach((database) => database.close()); });

function fixture(path = ":memory:", runtime?: ExecutionRuntimeAdapter) {
  const database = new Database(path);
  databases.push(database);
  const receipts = new ExecutionReceiptRepository(database, new Uint8Array(32).fill(7));
  let approval: ExecutionAuthorization | null = { principal, plan: structuredClone(original), expiresAt: 2000 };
  let currentGeneration = 1;
  const starts: ExecutionPlan[] = [];
  const inputs: Uint8Array[] = [];
  const selectedRuntime = runtime ?? {
    async putInput(_plan: ExecutionPlan, _slot: ExecutionPlan["inputs"][number], bytes: Uint8Array) { inputs.push(Uint8Array.from(bytes)); },
    discardInputs() {},
    async start(plan: ExecutionPlan) { starts.push(plan); },
  } satisfies ExecutionRuntimeAdapter;
  const runtimeWithLifecycle: ExecutionRuntimeAdapter = {
    ...selectedRuntime,
    discardInputs: selectedRuntime.discardInputs ?? (() => {}),
    cancel: selectedRuntime.cancel ?? ((executionId) => ({
      executionId, status: "running", stopReason: "cancelled", cleanup: "pending", exitCode: null,
    })),
    waitForCleanup: selectedRuntime.waitForCleanup ?? (async () => { throw new Error("Cleanup confirmation is unavailable."); }),
  };
  const options: ExecutionBrokerOptions = {
    profiles: [profile], now: () => 1000, readAuthorization: () => approval,
    credentialAuthority: {
      resolveBinding: (caller) => ({ scopeId: caller.instanceId === "other-instance" ? "session-2" : "session-1", generation: 1 }),
      isCurrent: (_principal, binding) => binding.generation === currentGeneration,
    },
    runtime: runtimeWithLifecycle,
  };
  return { database, receipts, options, starts, inputs,
    broker: new ExecutionBrokerService(receipts, options),
    revoke: () => { approval = null; },
    approve: (plan: ExecutionPlan, caller = principal) => { approval = { principal: caller, plan, expiresAt: 2000 }; },
    setGeneration: (generation: number) => { currentGeneration = generation; },
  };
}

function request(path: string, body: BodyInit, credential = token, contentType = "application/json", signal?: AbortSignal) {
  return new Request(`http://broker/v1/${path}`, {
    method: "POST", headers: { authorization: `Bearer ${credential}`, "content-type": contentType }, body, signal,
  });
}

describe("execution admission", () => {
  test("rejects Auth Check profile changes before prepare can reach runtime", () => {
    const authPlan = createAuthCheckExecutionPlan({ executionId: "auth-run", authorizationId: "auth-approval", origin: "https://example.test" });
    const database = new Database(":memory:");
    databases.push(database);
    const receipts = new ExecutionReceiptRepository(database, new Uint8Array(32).fill(7));
    let starts = 0;
    const broker = new ExecutionBrokerService(receipts, {
      profiles: [authCheckExecutionProfile],
      authCheckOutputProfileId: authCheckExecutionProfile.id,
      credentialAuthority: {
        resolveBinding: () => ({ scopeId: "scope-1", generation: 3 }),
        isCurrent: () => true,
      },
      readAuthorization: () => ({ principal, plan: authPlan, expiresAt: 2000 }),
      runtime: {
        async putInput() {},
        discardInputs() {},
        async start() { starts += 1; },
        cancel(executionId) { return { executionId, status: "running", stopReason: "cancelled", cleanup: "pending", exitCode: null }; },
        async waitForCleanup(executionId) { return { executionId, status: "finished", stopReason: "cancelled", cleanup: "confirmed", exitCode: null }; },
      },
      now: () => 1000,
    });
    for (const patch of [
      { invocation: { executableId: "bun", argv: ["run", "/tmp/attacker.js"] } },
      { inputs: [{ id: "other-slot", kind: "secret", maximumBytes: 128 * 1024 }] },
      { limits: { ...authPlan.limits, timeoutMs: 60_001 } },
      { origins: ["https://example.test", "https://other.test"] },
    ]) {
      expect(() => broker.prepare(principal, { ...authPlan, ...patch })).toThrow("INVALID_REQUEST");
    }
    expect(starts).toBe(0);
  });

  test("rejects a private config from another credential generation before runtime staging", async () => {
    const authPlan = createAuthCheckExecutionPlan({ executionId: "auth-stale-input", authorizationId: "auth-approval", origin: "https://example.test" });
    const database = new Database(":memory:");
    databases.push(database);
    const receipts = new ExecutionReceiptRepository(database, new Uint8Array(32).fill(7));
    let writes = 0;
    let starts = 0;
    const broker = new ExecutionBrokerService(receipts, {
      profiles: [authCheckExecutionProfile],
      authCheckOutputProfileId: authCheckExecutionProfile.id,
      credentialAuthority: { resolveBinding: () => ({ scopeId: "scope-1", generation: 3 }), isCurrent: () => true },
      readAuthorization: () => ({ principal, plan: authPlan, expiresAt: 2000 }),
      runtime: {
        async putInput() { writes += 1; },
        discardInputs() {},
        async start() { starts += 1; },
        cancel(executionId) { return { executionId, status: "running", stopReason: "cancelled", cleanup: "pending", exitCode: null }; },
        async waitForCleanup(executionId) { return { executionId, status: "finished", stopReason: "cancelled", cleanup: "confirmed", exitCode: null }; },
      },
      now: () => 1000,
    });
    broker.prepare(principal, authPlan);
    const staleConfig = {
      version: 1, operation: "auth-check", contextVersion: 2, targetOrigin: "https://example.test",
      verificationUrl: "https://example.test/check", authenticatedHeaders: ["cookie: old-generation-secret"],
      requestTimeoutMs: 10_000, maximumResponseBytes: 128_000, maximumRedirectCount: 5, totalDeadlineMs: 30_000,
    };
    await expect(broker.putInput(principal, authPlan.executionId, "auth-check-config", new TextEncoder().encode(JSON.stringify(staleConfig))))
      .rejects.toThrow("INVALID_REQUEST");
    expect(writes).toBe(0);
    expect(starts).toBe(0);
  });

  test("exposes an Auth Check frame only after its bound execution is closed and cleanup is confirmed", async () => {
    const authPlan = createAuthCheckExecutionPlan({ executionId: "auth-result-run", authorizationId: "auth-approval", origin: "https://example.test" });
    const database = new Database(":memory:");
    databases.push(database);
    const receipts = new ExecutionReceiptRepository(database, new Uint8Array(32).fill(7));
    const binding = { scopeId: "scope-1", generation: 3 };
    const safeFrame = JSON.stringify({ version: 1, operation: "auth-check", status: "failed", isProceedAllowed: false,
      unauthenticated: { status: 401, redirectCount: 0, hasCrossOriginRedirect: false, contentKind: "html", hasLoginForm: true },
      authenticated: { status: 403, redirectCount: 0, hasCrossOriginRedirect: false, contentKind: "html", hasLoginForm: true },
      differences: { statusChanged: true, redirectsChanged: false, contentKindChanged: false, contentChanged: false, titleChanged: false, loginFormChanged: false },
    });
    const broker = new ExecutionBrokerService(receipts, {
      profiles: [authCheckExecutionProfile],
      authCheckOutputProfileId: authCheckExecutionProfile.id,
      credentialAuthority: { resolveBinding: () => binding, isCurrent: () => true },
      readAuthorization: () => ({ principal, plan: authPlan, expiresAt: 2000 }),
      runtime: {
        async putInput() {},
        discardInputs() {},
        async start() {},
        cancel(executionId) { return { executionId, status: "running", stopReason: "cancelled", cleanup: "pending", exitCode: null }; },
        async waitForCleanup(executionId) { return { executionId, status: "finished", stopReason: "cancelled", cleanup: "confirmed", exitCode: null }; },
        readEvents(executionId, afterSequence) {
          return { executionId, events: afterSequence < 0 ? [{ executionId, sequence: 0, stream: "stdout", line: safeFrame }] : [], nextSequence: 0, hasMore: false };
        },
      },
      now: () => 1000,
    });
    broker.prepare(principal, authPlan);
    await broker.putInput(principal, authPlan.executionId, "auth-check-config", new TextEncoder().encode(JSON.stringify({
      version: 1, operation: "auth-check", contextVersion: 3, targetOrigin: "https://example.test",
      verificationUrl: "https://example.test/check", authenticatedHeaders: [], requestTimeoutMs: 10_000,
      maximumResponseBytes: 128_000, maximumRedirectCount: 5, totalDeadlineMs: 30_000,
    })));
    await broker.start(principal, authPlan.executionId);
    expect(() => broker.readEvents(principal, authPlan.executionId, -1)).toThrow("CONFLICT");
    receipts.recordOutcome({ executionId: authPlan.executionId, cause: "normal", exitCode: 0, cleanup: "confirmed" });
    expect(broker.readEvents(principal, authPlan.executionId, -1).events[0]?.line).toBe(safeFrame);
  });

  test.each([
    { mounts: ["/Users:/host"] }, { image: "attacker" }, { capabilities: ["ALL"] },
    { version: 2 }, { origins: ["https://example.test/path"] },
    { origins: ["https://example.test:443"] }, { origins: ["https://user:pass@example.test"] },
    { invocation: { executableId: "sh", argv: [] } },
    { invocation: { executableId: "curl", argv: ["x".repeat(32769)] } },
    { inputs: [{ id: "credentials", kind: "data", maximumBytes: 256 }] },
    { limits: { ...limits, processCount: 5 } }, { limits: { ...limits, timeoutMs: Infinity } },
  ])("rejects an invalid execution plan", (patch) => {
    expect(() => parseExecutionPlan({ ...original, ...patch }, [profile])).toThrow();
  });

  test("binds exact plan and ownership to server-side approval", () => {
    const { broker } = fixture();
    expect(() => broker.prepare(principal, { ...original, origins: ["https://other.test"] })).toThrow("UNAUTHORIZED");
    expect(() => broker.prepare({ ...principal, instanceId: "other" }, original)).toThrow("UNAUTHORIZED");
    broker.prepare(principal, original);
    expect(() => broker.get({ ...principal, instanceId: "other" }, original.executionId)).toThrow("NOT_FOUND");
  });

  test("caps the aggregate declared input budget at eight mebibytes", () => {
    const largeSlots = [
      { id: "credentials", kind: "secret" as const, maximumBytes: 5 * 1024 * 1024 },
      { id: "payload", kind: "data" as const, maximumBytes: 4 * 1024 * 1024 },
    ];
    expect(() => parseExecutionPlan({ ...original, inputs: largeSlots }, [{ ...profile, inputs: largeSlots }]))
      .toThrow("input slots");
  });

  test("keeps a durable grant bound through prepare, input sealing, and start", async () => {
    const database = new Database(":memory:");
    databases.push(database);
    const receipts = new ExecutionReceiptRepository(database, new Uint8Array(32).fill(7));
    const ledger = new ExecutionAuthorizationLedgerRepository(database, new Uint8Array(32).fill(7), [profile], () => 1000);
    ledger.issue(principal, original, 2000);
    let starts = 0;
    const broker = new ExecutionBrokerService(receipts, {
      profiles: [profile],
      credentialAuthority: {
        resolveBinding: () => ({ scopeId: "session-1", generation: 1 }),
        isCurrent: () => true,
      },
      now: () => 1000,
      readAuthorization(caller, authorizationId, requestedPlan) {
        return requestedPlan ? ledger.claim(caller, authorizationId, requestedPlan) : null;
      },
      runtime: {
        async putInput() {},
        discardInputs() {},
        async start() { starts++; },
        cancel(executionId) { return { executionId, status: "running", stopReason: "cancelled", cleanup: "pending", exitCode: null }; },
        async waitForCleanup(executionId) { return { executionId, status: "finished", stopReason: "cancelled", cleanup: "confirmed", exitCode: null }; },
      },
    });
    broker.prepare(principal, original);
    await broker.putInput(principal, original.executionId, "credentials", new Uint8Array([1]));
    await broker.start(principal, original.executionId);
    expect(starts).toBe(1);
    expect(ledger.claim(principal, "approval-1", { ...original, executionId: "another-run" })).toBeNull();
  });

  test("cancels a prepared run durably without starting a target process", async () => {
    let starts = 0;
    let discarded = 0;
    const state = fixture(":memory:", {
      async putInput() {},
      async start() { starts++; },
      discardInputs() { discarded++; },
    });
    state.broker.prepare(principal, original);

    const cancellation = await state.broker.cancel(principal, original.executionId);

    expect(cancellation).toMatchObject({ status: "finished", stopReason: "cancelled", cleanup: "confirmed", exitCode: null });
    expect(await state.broker.cancel(principal, original.executionId)).toEqual(cancellation);
    expect(state.broker.status(principal, original.executionId)).toEqual(cancellation);
    expect(state.broker.get(principal, original.executionId)).toMatchObject({ status: "closed", cleanup: "confirmed" });
    expect(starts).toBe(0);
    expect(discarded).toBe(1);
  });

  test("cancellation during input upload blocks a concurrent start and discards the staged slot", async () => {
    let announceWrite!: () => void;
    let finishWrite!: () => void;
    const writeStarted = new Promise<void>((resolve) => { announceWrite = resolve; });
    const writeGate = new Promise<void>((resolve) => { finishWrite = resolve; });
    let starts = 0;
    let discarded = 0;
    const state = fixture(":memory:", {
      async putInput() { announceWrite(); await writeGate; },
      async start() { starts++; },
      discardInputs() { discarded++; },
    });
    state.broker.prepare(principal, original);
    const upload = state.broker.putInput(principal, original.executionId, "credentials", new Uint8Array([1]));
    await writeStarted;

    const cancellation = state.broker.cancel(principal, original.executionId);
    const repeatedCancellation = state.broker.cancel(principal, original.executionId);
    await expect(state.broker.start(principal, original.executionId)).rejects.toThrow("CONFLICT");
    finishWrite();
    await upload;

    expect(await cancellation).toMatchObject({ status: "finished", stopReason: "cancelled", cleanup: "confirmed" });
    expect(await repeatedCancellation).toEqual(await cancellation);
    expect(starts).toBe(0);
    expect(discarded).toBe(1);
    expect(state.broker.get(principal, original.executionId)).toMatchObject({ status: "closed", cleanup: "confirmed" });
  });

  test("rejects a grant that expires after prepare but before start", async () => {
    const database = new Database(":memory:");
    databases.push(database);
    const receipts = new ExecutionReceiptRepository(database, new Uint8Array(32).fill(7));
    const publicProfile = { ...profile, id: "public-curl-v1", mode: "public", inputs: [] };
    const publicPlan = { ...original, profileId: publicProfile.id, mode: "public", inputs: [] };
    let now = 1000;
    const ledger = new ExecutionAuthorizationLedgerRepository(database, new Uint8Array(32).fill(7), [publicProfile], () => now);
    ledger.issue(principal, publicPlan, 2000);
    let starts = 0;
    const broker = new ExecutionBrokerService(receipts, {
      profiles: [publicProfile], now: () => now,
      readAuthorization(caller, authorizationId, requestedPlan) {
        return requestedPlan ? ledger.claim(caller, authorizationId, requestedPlan) : null;
      },
      runtime: { async putInput() {}, async start() { starts++; } },
    });
    broker.prepare(principal, publicPlan);
    now = 2000;
    await expect(broker.start(principal, publicPlan.executionId)).rejects.toThrow("UNAUTHORIZED");
    expect(starts).toBe(0);
  });

  test("seals only declared input, wipes adapter buffer and starts at most once", async () => {
    const buffers: Uint8Array[] = [];
    let count = 0;
    const { broker } = fixture(":memory:", {
      async putInput(_plan, _slot, bytes) { buffers.push(bytes); },
      async start() { count++; },
    });
    broker.prepare(principal, original);
    await expect(broker.start(principal, "run-1")).rejects.toThrow("CONFLICT");
    await expect(broker.putInput(principal, "run-1", "other", new Uint8Array())).rejects.toThrow("INVALID_REQUEST");
    const secret = new TextEncoder().encode("secret-canary");
    await broker.putInput(principal, "run-1", "credentials", secret);
    expect(buffers[0]!.every((byte) => byte === 0)).toBe(true);
    await broker.putInput(principal, "run-1", "credentials", secret);
    expect(buffers).toHaveLength(1);
    await expect(broker.putInput(principal, "run-1", "credentials", new Uint8Array([1]))).rejects.toThrow("CONFLICT");
    await Promise.all([broker.start(principal, "run-1"), broker.start(principal, "run-1")]);
    expect(count).toBe(1);
    expect(broker.get(principal, "run-1").status).toBe("started");
  });

  test("discards an earlier staged slot when a later runtime upload fails", async () => {
    const slots = [
      { id: "credentials", kind: "secret" as const, maximumBytes: 256 },
      { id: "payload", kind: "data" as const, maximumBytes: 128 },
    ];
    const profileWithInputs = { ...profile, inputs: slots };
    const plan = { ...original, inputs: slots };
    const database = new Database(":memory:");
    databases.push(database);
    const receipts = new ExecutionReceiptRepository(database, new Uint8Array(32).fill(7));
    const policy: HttpExecutionNetworkPolicy = {
      executionId: plan.executionId, origins: plan.origins,
      endpoints: [{ origin: "https://example.test", hostname: "example.test", address: "93.184.216.34", family: 4, port: 443 }],
    };
    const supervisor = new HttpExecutionSupervisorService({ async run() { throw new Error("must not run"); } },
      { async resolve() { return policy; } }, { leaseMs: 1_000, onSettled() {} });
    let uploadCount = 0;
    const runtime: ExecutionRuntimeAdapter = {
      async putInput(runPlan, slot, bytes) {
        uploadCount += 1;
        if (uploadCount === 2) throw new Error("injected later slot failure");
        await supervisor.putInput(runPlan, slot, bytes);
      },
      discardInputs(executionId) { supervisor.discardInputs(executionId); },
      async start(runPlan) { await supervisor.start(runPlan); },
      cancel(executionId) { return supervisor.cancel(executionId); },
      waitForCleanup(executionId) { return supervisor.waitForCleanup(executionId); },
    };
    const broker = new ExecutionBrokerService(receipts, {
      profiles: [profileWithInputs],
      credentialAuthority: {
        resolveBinding: () => ({ scopeId: "session-1", generation: 1 }),
        isCurrent: () => true,
      },
      readAuthorization: () => ({ principal, plan, expiresAt: 2000 }),
      runtime,
      now: () => 1000,
    });
    broker.prepare(principal, plan);
    await broker.putInput(principal, plan.executionId, "credentials", new TextEncoder().encode("first-secret"));
    await expect(broker.putInput(principal, plan.executionId, "payload", new Uint8Array([1])))
      .rejects.toThrow("UNAVAILABLE");
    expect(receipts.find(plan.executionId)?.status).toBe("interrupted");
    await expect(supervisor.start(plan)).rejects.toThrow("missing, expired");
  });

  test("wipes sealed input when authorization expires before start", async () => {
    const staged: Uint8Array[] = [];
    const state = fixture(":memory:", {
      async putInput(_plan, _slot, bytes) { staged.push(Uint8Array.from(bytes)); },
      discardInputs() { staged.forEach((bytes) => bytes.fill(0)); },
      async start() { throw new Error("must not run"); },
    });
    state.broker.prepare(principal, original);
    await state.broker.putInput(principal, original.executionId, "credentials", new TextEncoder().encode("expires-before-start"));
    state.revoke();
    await expect(state.broker.start(principal, original.executionId)).rejects.toThrow("UNAUTHORIZED");
    expect([...staged[0]!]).toEqual(new Array("expires-before-start".length).fill(0));
    expect(state.receipts.find(original.executionId)?.status).toBe("interrupted");
  });

  test("blocks start during upload and rejects revocation before sealing", async () => {
    let release!: () => void;
    const waiting = new Promise<void>((resolve) => { release = resolve; });
    const state = fixture(":memory:", { async putInput() { await waiting; }, async start() { throw new Error("must not run"); } });
    state.broker.prepare(principal, original);
    const uploading = state.broker.putInput(principal, "run-1", "credentials", new Uint8Array([1]));
    await expect(state.broker.start(principal, "run-1")).rejects.toThrow("CONFLICT");
    state.revoke();
    release();
    await expect(uploading).rejects.toThrow("UNAVAILABLE");
    expect(state.broker.get(principal, "run-1").status).toBe("interrupted");
  });

  test("revocation before start prevents adapter invocation", async () => {
    const state = fixture();
    state.broker.prepare(principal, original);
    await state.broker.putInput(principal, "run-1", "credentials", new Uint8Array([1]));
    state.revoke();
    await expect(state.broker.start(principal, "run-1")).rejects.toThrow("UNAUTHORIZED");
    expect(state.starts).toHaveLength(0);
  });

  test("generation revocation closes prepared inputs and leaves public or other-scope receipts alone", async () => {
    const state = fixture();
    state.broker.prepare(principal, original);
    await state.broker.putInput(principal, original.executionId, "credentials", new Uint8Array([1, 2]));
    const otherPrincipal = { ...principal, instanceId: "other-instance" };
    const otherPlan = { ...original, executionId: "run-other", authorizationId: "approval-other" };
    state.approve(otherPlan, otherPrincipal);
    state.broker.prepare(otherPrincipal, otherPlan);
    const sameSessionPrincipal = { ...principal, instanceId: "same-session-instance" };
    const sameSessionPlan = { ...original, executionId: "run-same-session", authorizationId: "approval-same-session" };
    state.approve(sameSessionPlan, sameSessionPrincipal);
    state.broker.prepare(sameSessionPrincipal, sameSessionPlan);
    const publicOwner = state.receipts.fingerprint([principal.installationId, "public-instance"]);
    state.receipts.reserve(publicOwner, "run-public", "public-fingerprint", null, state.receipts.fingerprint([principal.installationId]));

    await state.broker.revokeCredentialGeneration(principal, { scopeId: "session-1", generation: 1 });

    expect(state.broker.get(principal, original.executionId)).toMatchObject({ status: "closed", cleanup: "confirmed" });
    expect(state.broker.get(sameSessionPrincipal, sameSessionPlan.executionId)).toMatchObject({ status: "closed", cleanup: "confirmed" });
    expect(state.broker.get(otherPrincipal, otherPlan.executionId)).toMatchObject({ status: "prepared", cleanup: "pending" });
    expect(state.receipts.find("run-public")).toMatchObject({ status: "prepared", credentialRevoked: false });
    state.setGeneration(2);
    const newPlan = { ...original, executionId: "run-new" };
    state.approve(newPlan);
    expect(() => state.broker.prepare(principal, newPlan)).toThrow("UNAUTHORIZED");
  });

  test("generation revocation wins against an in-flight secret upload", async () => {
    let release!: () => void;
    let entered!: () => void;
    const writing = new Promise<void>((resolve) => { entered = resolve; });
    const gate = new Promise<void>((resolve) => { release = resolve; });
    let discarded = 0;
    const state = fixture(":memory:", {
      async putInput() { entered(); await gate; },
      discardInputs() { discarded++; },
      async start() { throw new Error("must not start"); },
    });
    state.broker.prepare(principal, original);
    const upload = state.broker.putInput(principal, original.executionId, "credentials", new Uint8Array([1]));
    await writing;
    state.setGeneration(2);
    const revocation = state.broker.revokeCredentialGeneration(principal, { scopeId: "session-1", generation: 1 });
    await expect(state.broker.start(principal, original.executionId)).rejects.toThrow("CONFLICT");
    release();
    await expect(upload).rejects.toThrow("UNAVAILABLE");
    await revocation;
    expect(discarded).toBeGreaterThanOrEqual(1);
    expect(state.broker.get(principal, original.executionId)).toMatchObject({ status: "closed", cleanup: "confirmed" });
  });

  test("generation revocation waits for durable settlement after runtime cleanup reports confirmed", async () => {
    let finishStart!: () => void;
    const startGate = new Promise<void>((resolve) => { finishStart = resolve; });
    let finishCleanup!: () => void;
    const cleanupGate = new Promise<void>((resolve) => { finishCleanup = resolve; });
    let receipts!: ExecutionReceiptRepository;
    let cancelCount = 0;
    const state = fixture(":memory:", {
      async putInput() {},
      async start() { await startGate; },
      cancel() {
        cancelCount++;
        return { executionId: original.executionId, status: "finished", stopReason: "cancelled", cleanup: "confirmed", exitCode: null };
      },
      async waitForCleanup(executionId) {
        await cleanupGate;
        receipts.recordOutcome({ executionId, cause: "cancelled", exitCode: null, cleanup: "confirmed" });
        return { executionId, status: "finished", stopReason: "cancelled", cleanup: "confirmed", exitCode: null };
      },
    });
    receipts = state.receipts;
    state.broker.prepare(principal, original);
    await state.broker.putInput(principal, original.executionId, "credentials", new Uint8Array([1]));
    const starting = state.broker.start(principal, original.executionId);
    await Bun.sleep(0);
    state.setGeneration(2);
    let revocationFinished = false;
    const revocation = state.broker.revokeCredentialGeneration(principal, { scopeId: "session-1", generation: 1 })
      .then(() => { revocationFinished = true; });
    expect(cancelCount).toBeGreaterThan(0);
    finishStart();
    await starting;
    await Bun.sleep(0);
    expect(revocationFinished).toBe(false);
    finishCleanup();
    await revocation;
    expect(revocationFinished).toBe(true);
    expect(cancelCount).toBeGreaterThanOrEqual(1);
    expect(state.broker.get(principal, original.executionId)).toMatchObject({ status: "closed", cleanup: "confirmed" });
  });

  test("failed revoked-run cleanup keeps the broker locked", async () => {
    const state = fixture(":memory:", {
      async putInput() {},
      async start() {},
      cancel(executionId) {
        return { executionId, status: "running", stopReason: "cancelled", cleanup: "pending", exitCode: null };
      },
      async waitForCleanup() { throw new Error("injected cleanup uncertainty"); },
    });
    state.broker.prepare(principal, original);
    await state.broker.putInput(principal, original.executionId, "credentials", new Uint8Array([1]));
    await state.broker.start(principal, original.executionId);
    await expect(state.broker.revokeCredentialGeneration(principal, { scopeId: "session-1", generation: 1 }))
      .rejects.toThrow("UNAVAILABLE");
    expect(state.receipts.find(original.executionId)).toMatchObject({ status: "interrupted", cleanup: "pending", credentialRevoked: true });
    const nextPlan = { ...original, executionId: "run-next" };
    state.approve(nextPlan);
    expect(() => state.broker.prepare(principal, nextPlan)).toThrow("UNAVAILABLE");
  });

  test("authenticated profiles fail closed without trusted authority and reject caller-supplied bindings", () => {
    const state = fixture();
    const { credentialAuthority: _authority, ...untrustedOptions } = state.options;
    const broker = new ExecutionBrokerService(state.receipts, untrustedOptions);
    expect(() => broker.prepare(principal, original)).toThrow("UNAVAILABLE");
    expect(() => broker.prepare(principal, { ...original, credentialBinding: { scopeId: "session-1", generation: 1 } }))
      .toThrow("INVALID_REQUEST");
  });

  test("rejects structurally corrupt persisted credential bindings", () => {
    const state = fixture();
    state.broker.prepare(principal, original);
    state.database.query("UPDATE execution_receipts SET credential_generation = NULL WHERE execution_id = ?")
      .run(original.executionId);
    expect(() => state.receipts.find(original.executionId)).toThrow("credential binding journal is malformed");
  });

  test("an uncertain start is never retried and requires cleanup reconciliation", async () => {
    let count = 0;
    const state = fixture(":memory:", { async putInput() {}, async start() { count++; throw new Error("driver secret"); } });
    state.broker.prepare(principal, original);
    await state.broker.putInput(principal, "run-1", "credentials", new Uint8Array([1]));
    await expect(state.broker.start(principal, "run-1")).rejects.toThrow("UNAVAILABLE");
    await state.broker.start(principal, "run-1");
    expect(count).toBe(1);
    const next = { ...original, executionId: "run-2" };
    state.approve(next);
    expect(() => state.broker.prepare(principal, next)).toThrow("UNAVAILABLE");
    state.receipts.confirmCleanup("run-1");
    expect(state.broker.prepare(principal, next).status).toBe("prepared");
  });

  test("persists tombstones across database reopen without secret or argv content", async () => {
    const directory = await mkdtemp(join(tmpdir(), "nulltrace-receipts-"));
    try {
      const path = join(directory, "receipts.sqlite");
      const first = fixture(path);
      first.broker.prepare(principal, original);
      await first.broker.putInput(principal, "run-1", "credentials", new TextEncoder().encode("secret-canary"));
      await first.broker.start(principal, "run-1");
      first.database.close();
      databases.splice(databases.indexOf(first.database), 1);
      const second = fixture(path);
      expect((await second.broker.start(principal, "run-1")).status).toBe("interrupted");
      expect(second.starts).toHaveLength(0);
      const contents = (await readFile(path)).toString();
      expect(contents).not.toContain("secret-canary");
      expect(contents).not.toContain("https://example.test");
    } finally { await rm(directory, { recursive: true, force: true }); }
  });

  test("does not replace an active execution belonging to the same caller", () => {
    const state = fixture();
    state.broker.prepare(principal, original);
    const next = { ...original, executionId: "run-2" };
    state.approve(next);
    expect(() => state.broker.prepare(principal, next)).toThrow("CONFLICT");
    expect(state.broker.get(principal, "run-1").status).toBe("prepared");
  });

  test("missing runtime fails closed", () => {
    const state = fixture();
    const broker = new ExecutionBrokerService(state.receipts, { ...state.options, runtime: undefined });
    expect(() => broker.prepare(principal, original)).toThrow("UNAVAILABLE");
    expect(state.starts).toHaveLength(0);
  });
});

describe("broker transport", () => {
  test("drains active requests before closing a private broker host", async () => {
    const state = fixture();
    const http = new ExecutionBrokerHttpService(state.broker, [{ token, principal }]);
    const controller = new AbortController();
    const stream = new ReadableStream<Uint8Array>({ start(writer) { writer.enqueue(new Uint8Array([123])); } });
    const response = http.handle(request("prepare", stream, token, "application/json", controller.signal));
    let drained = false;
    const idle = http.waitForIdle().then(() => { drained = true; });
    http.beginShutdown();
    expect((await http.handle(request("get", JSON.stringify({ executionId: "run-1" })))).status).toBe(503);
    expect(drained).toBe(false);
    controller.abort();
    expect((await response).status).toBe(400);
    await idle;
    expect(drained).toBe(true);
  });

  test("controls only an owned started run without replaying its start", async () => {
    let starts = 0;
    let renewals = 0;
    let cancellations = 0;
    const state = fixture(":memory:", {
      async putInput() {},
      async start() { starts++; },
      renewOwnership(executionId) {
        renewals++;
        return { executionId, status: "running", stopReason: null, cleanup: "pending", exitCode: null };
      },
      cancel(executionId) {
        cancellations++;
        return { executionId, status: "running", stopReason: "cancelled", cleanup: "pending", exitCode: null };
      },
    });
    const foreignToken = "b".repeat(64);
    const http = new ExecutionBrokerHttpService(state.broker, [
      { token, principal },
      { token: foreignToken, principal: { ...principal, instanceId: "other" } },
    ]);
    const client = new ExecutionBrokerClient((request) => http.handle(request), token);
    await client.prepare(original);
    await expect(client.renewOwnership("run-1")).rejects.toThrow("CONFLICT");
    await client.putInput("run-1", "credentials", new Uint8Array([1]));
    await client.start("run-1");
    expect(await client.renewOwnership("run-1")).toMatchObject({ status: "running", cleanup: "pending" });
    expect(await client.cancel("run-1")).toMatchObject({ status: "running", stopReason: "cancelled", cleanup: "pending" });
    expect(await client.cancel("run-1")).toMatchObject({ status: "running", stopReason: "cancelled" });
    await expect(state.broker.cancel({ ...principal, instanceId: "other" }, "run-1")).rejects.toThrow("NOT_FOUND");
    expect(() => state.broker.renewOwnership({ ...principal, instanceId: "other" }, "run-1")).toThrow("NOT_FOUND");
    expect((await http.handle(request("cancel", JSON.stringify({ executionId: "run-1" }), foreignToken))).status).toBe(404);
    expect(starts).toBe(1);
    expect(renewals).toBe(1);
    expect(cancellations).toBe(2);
  });

  test("rejects forged or contradictory control receipts", async () => {
    for (const receipt of [
      { executionId: "other", status: "running", stopReason: null, cleanup: "pending", exitCode: null },
      { executionId: "run-1", status: "finished", stopReason: null, cleanup: "pending", exitCode: 0 },
      { executionId: "run-1", status: "running", stopReason: null, cleanup: "pending", exitCode: "0" },
    ]) {
      const client = new ExecutionBrokerClient(async () => Response.json(receipt), token);
      await expect(client.cancel("run-1")).rejects.toThrow("UNAVAILABLE");
    }
  });

  test("pages public events only for the approved execution owner", async () => {
    const database = new Database(":memory:");
    databases.push(database);
    const receipts = new ExecutionReceiptRepository(database, new Uint8Array(32).fill(7));
    const publicProfile: ExecutionProfile = { ...profile, id: "public-http", mode: "public", inputs: [] };
    const publicPlan: ExecutionPlan = { ...original, profileId: publicProfile.id, mode: "public", inputs: [] };
    const broker = new ExecutionBrokerService(receipts, {
      profiles: [publicProfile],
      now: () => 1000,
      readAuthorization: () => ({ principal, plan: publicPlan, expiresAt: 2000 }),
      runtime: {
        async putInput() {},
        async start() {},
        readEvents(executionId, afterSequence) {
          return {
            executionId,
            events: afterSequence < 0 ? [{ executionId, sequence: 0, stream: "stdout", line: "safe" }] : [],
            nextSequence: Math.max(afterSequence, 0),
            hasMore: false,
          };
        },
      },
    });
    const http = new ExecutionBrokerHttpService(broker, [{ token, principal }]);
    const client = new ExecutionBrokerClient((request) => http.handle(request), token);
    await client.prepare(publicPlan);
    await client.start(publicPlan.executionId);
    expect(await client.readEvents(publicPlan.executionId, -1)).toMatchObject({
      events: [{ sequence: 0, line: "safe" }], nextSequence: 0,
    });
    expect(() => broker.readEvents({ ...principal, instanceId: "other" }, publicPlan.executionId, -1)).toThrow("NOT_FOUND");
    expect((await http.handle(request("events", JSON.stringify({ executionId: "run-1", afterSequence: -2 })))).status).toBe(400);
  });

  test("allows events only for the release-approved public cURL data profile", async () => {
    const workerProfile: ExecutionProfile = {
      id: "public-curl-worker-v1", tool: "curl", mode: "public-worker", executableIds: ["bun"],
      inputs: [{ id: "curl-config", kind: "data", maximumBytes: 2 * 1024 * 1024 }], maximumLimits: limits,
    };
    const workerPlan: ExecutionPlan = {
      ...original,
      profileId: workerProfile.id,
      mode: workerProfile.mode,
      invocation: { executableId: "bun", argv: ["run", "/opt/nulltrace/workers/curl-worker.ts"] },
      inputs: workerProfile.inputs,
    };
    const createWorkerBroker = (selectedProfile: ExecutionProfile, selectedPlan: ExecutionPlan, eventProfiles: string[]) => {
      const database = new Database(":memory:");
      databases.push(database);
      const receipts = new ExecutionReceiptRepository(database, new Uint8Array(32).fill(7));
      const broker = new ExecutionBrokerService(receipts, {
        profiles: [selectedProfile],
        publicDataEventProfileIds: eventProfiles,
        credentialAuthority: {
          resolveBinding: () => ({ scopeId: "session-1", generation: 1 }),
          isCurrent: () => true,
        },
        now: () => 1000,
        readAuthorization: () => ({ principal, plan: selectedPlan, expiresAt: 2000 }),
        runtime: {
          async putInput() {},
          discardInputs() {},
          async start() {},
          cancel(executionId) { return { executionId, status: "running", stopReason: "cancelled", cleanup: "pending", exitCode: null }; },
          async waitForCleanup(executionId) { return { executionId, status: "finished", stopReason: "cancelled", cleanup: "confirmed", exitCode: null }; },
          readEvents(executionId, afterSequence) {
            return {
              executionId,
              events: afterSequence < 0 ? [{ executionId, sequence: 0, stream: "stdout", line: "worker-output" }] : [],
              nextSequence: Math.max(afterSequence, 0),
              hasMore: false,
            };
          },
        },
      });
      return broker;
    };
    const allowed = createWorkerBroker(workerProfile, workerPlan, [workerProfile.id]);
    allowed.prepare(principal, workerPlan);
    await allowed.putInput(principal, workerPlan.executionId, "curl-config", new TextEncoder().encode("{}"));
    await allowed.start(principal, workerPlan.executionId);
    expect(allowed.readEvents(principal, workerPlan.executionId, -1).events[0]?.line).toBe("worker-output");

    const mismatchedProfile = { ...workerProfile, id: "other-public-worker-v1" };
    const mismatchedPlan = { ...workerPlan, profileId: mismatchedProfile.id };
    const mismatched = createWorkerBroker(mismatchedProfile, mismatchedPlan, [workerProfile.id]);
    mismatched.prepare(principal, mismatchedPlan);
    await mismatched.putInput(principal, mismatchedPlan.executionId, "curl-config", new TextEncoder().encode("{}"));
    await mismatched.start(principal, mismatchedPlan.executionId);
    expect(() => mismatched.readEvents(principal, mismatchedPlan.executionId, -1)).toThrow("CONFLICT");

    const secretProfile: ExecutionProfile = {
      ...workerProfile, inputs: [{ id: "curl-config", kind: "secret", maximumBytes: 2 * 1024 * 1024 }],
    };
    const secretPlan = { ...workerPlan, inputs: secretProfile.inputs };
    const secretBroker = createWorkerBroker(secretProfile, secretPlan, [workerProfile.id]);
    secretBroker.prepare(principal, secretPlan);
    await secretBroker.putInput(principal, secretPlan.executionId, "curl-config", new TextEncoder().encode("{}"));
    await secretBroker.start(principal, secretPlan.executionId);
    expect(() => secretBroker.readEvents(principal, secretPlan.executionId, -1)).toThrow("CONFLICT");
  });

  test("rejects broker event pages with control bytes or sequence gaps", async () => {
    for (const event of [
      { executionId: "run-1", sequence: 2, stream: "stdout", line: "safe" },
      { executionId: "run-1", sequence: 0, stream: "stdout", line: "\u001b[31msecret" },
    ]) {
      const client = new ExecutionBrokerClient(async () => Response.json({
        executionId: "run-1", events: [event], nextSequence: event.sequence, hasMore: false,
      }), token);
      await expect(client.readEvents("run-1", -1)).rejects.toThrow("UNAVAILABLE");
    }
  });

  test("authenticates before reading untrusted payloads and sanitizes errors", async () => {
    const state = fixture(":memory:", { async putInput() {}, async start() { throw new Error("driver-secret-canary"); } });
    const http = new ExecutionBrokerHttpService(state.broker, [{ token, principal }]);
    const unauthorized = await http.handle(request("prepare", "not JSON", "b".repeat(64)));
    expect(unauthorized.status).toBe(401);
    const client = new ExecutionBrokerClient((request) => http.handle(request), token);
    await client.prepare(original);
    await client.putInput("run-1", "credentials", new Uint8Array([1]));
    const response = await http.handle(request("start", JSON.stringify({ executionId: "run-1" })));
    expect(await response.text()).toBe('{"error":"UNAVAILABLE"}');
  });

  test("rejects oversized and aborted uploads without sealing partial secrets", async () => {
    const state = fixture();
    const http = new ExecutionBrokerHttpService(state.broker, [{ token, principal }]);
    state.broker.prepare(principal, original);
    expect((await http.handle(request("input/run-1/credentials", new Uint8Array(257), token, "application/octet-stream"))).status).toBe(400);
    const controller = new AbortController();
    const stream = new ReadableStream({ start(writer) { writer.enqueue(new Uint8Array([1])); } });
    const response = http.handle(request("input/run-1/credentials", stream, token, "application/octet-stream", controller.signal));
    controller.abort();
    expect((await response).status).toBe(400);
    expect(state.inputs).toHaveLength(0);
    await expect(state.broker.start(principal, "run-1")).rejects.toThrow("CONFLICT");
  });

  test("real Unix socket round trip preserves admission receipts", async () => {
    const directory = await mkdtemp(join(tmpdir(), "nulltrace-broker-"));
    await chmod(directory, 0o700);
    const unix = join(directory, "broker.sock");
    const state = fixture();
    const http = new ExecutionBrokerHttpService(state.broker, [{ token, principal }]);
    const server = Bun.serve({ unix, fetch: (request) => http.handle(request) });
    try {
      await chmod(unix, 0o600);
      const client = new ExecutionBrokerClient((request) => fetch(request, { unix }), token);
      expect((await client.prepare(original)).status).toBe("prepared");
      await client.putInput("run-1", "credentials", new TextEncoder().encode("socket-secret"));
      expect((await client.start("run-1")).status).toBe("started");
      expect(await client.get("run-1")).toEqual({ executionId: "run-1", status: "started", cleanup: "pending" });
      expect(state.starts).toHaveLength(1);
    } finally { await server.stop(true); await rm(directory, { recursive: true, force: true }); }
  });
});

describe("failure limits", () => {
  test("expired approval and malformed resource ceilings are rejected", () => {
    const state = fixture();
    const expired = new ExecutionBrokerService(state.receipts, { ...state.options, now: () => 2000 });
    expect(() => expired.prepare(principal, original)).toThrow("UNAUTHORIZED");
    expect(() => parseExecutionPlan(original, [{ ...profile, maximumLimits: { ...limits, memoryBytes: NaN } }])).toThrow();
  });

  test("retains consumed IDs when receipt capacity is exhausted", () => {
    const database = new Database(":memory:");
    databases.push(database);
    const repository = new ExecutionReceiptRepository(database, new Uint8Array(32), 1);
    repository.reserve("owner", "one", "fingerprint");
    repository.confirmCleanup("one");
    expect(() => repository.reserve("owner", "two", "fingerprint")).toThrow("CAPACITY");
    expect(repository.reserve("owner", "one", "fingerprint").status).toBe("closed");
    expect(() => repository.reserve("owner", "one", "changed")).toThrow("CONFLICT");
  });

  test("input deadline rejects a partial body rather than accepting EOF", async () => {
    const state = fixture();
    const http = new ExecutionBrokerHttpService(state.broker, [{ token, principal }]);
    state.broker.prepare(principal, original);
    const stream = new ReadableStream({ start(writer) { writer.enqueue(new Uint8Array([1])); } });
    const response = await http.handle(request("input/run-1/credentials", stream, token, "application/octet-stream"));
    expect(response.status).toBe(400);
    expect(state.inputs).toHaveLength(0);
  }, 7000);

  test("client rejects oversized, mismatched and contradictory receipts", async () => {
    for (const response of [
      new Response("x".repeat(4097)),
      Response.json({ executionId: "other", status: "started", cleanup: "pending" }),
      Response.json({ executionId: "run-1", status: "prepared", cleanup: "confirmed" }),
    ]) {
      const client = new ExecutionBrokerClient(async () => response, token);
      await expect(client.get("run-1")).rejects.toThrow("UNAVAILABLE");
    }
  });
});
