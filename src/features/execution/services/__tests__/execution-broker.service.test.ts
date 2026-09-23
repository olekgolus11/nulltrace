import { afterEach, describe, expect, test } from "bun:test";
import { Database } from "bun:sqlite";
import { mkdtemp, readFile, rm, chmod } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { ExecutionBrokerService } from "../execution-broker.service";
import { ExecutionReceiptRepository } from "../execution-receipt.repository";
import { ExecutionBrokerHttpService } from "../execution-broker-http.service";
import { ExecutionBrokerClient } from "../execution-broker-client.service";
import { parseExecutionPlan } from "../execution-plan.helpers";
import { ExecutionAuthorization, ExecutionRuntimeAdapter } from "../../types/execution-broker.types";
import { ExecutionPlan, ExecutionProfile } from "../../types/execution-plan.types";

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
  const starts: ExecutionPlan[] = [];
  const inputs: Uint8Array[] = [];
  const options = {
    profiles: [profile], now: () => 1000, readAuthorization: () => approval,
    runtime: runtime ?? {
      async putInput(_plan, _slot, bytes) { inputs.push(Uint8Array.from(bytes)); },
      async start(plan) { starts.push(plan); },
    } satisfies ExecutionRuntimeAdapter,
  };
  return { database, receipts, options, starts, inputs,
    broker: new ExecutionBrokerService(receipts, options),
    revoke: () => { approval = null; },
    approve: (plan: ExecutionPlan) => { approval = { principal, plan, expiresAt: 2000 }; },
  };
}

function request(path: string, body: BodyInit, credential = token, contentType = "application/json", signal?: AbortSignal) {
  return new Request(`http://broker/v1/${path}`, {
    method: "POST", headers: { authorization: `Bearer ${credential}`, "content-type": contentType }, body, signal,
  });
}

describe("execution admission", () => {
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
    expect(() => state.broker.cancel({ ...principal, instanceId: "other" }, "run-1")).toThrow("NOT_FOUND");
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
