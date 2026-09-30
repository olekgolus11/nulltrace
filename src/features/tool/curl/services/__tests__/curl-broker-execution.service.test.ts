import { describe, expect, test } from "bun:test";
import { ExecutionBrokerClient } from "../../../../execution/services/execution-broker-client.service";
import { ExecutionBrokerClientConfiguration } from "../../../../execution/types/execution-broker-client.types";
import { CurlBrokerExecutionService } from "../curl-broker-execution.service";

const configuration: ExecutionBrokerClientConfiguration = {
  directory: "/tmp/isolated-curl-test",
  principal: { installationId: "test-install", instanceId: "test-app" },
  clientToken: "a".repeat(64),
  adminToken: "b".repeat(64),
};

describe("CurlBrokerExecutionService", () => {
  test("grants a fixed worker plan, uploads private request data, and replays output", async () => {
    let plan: unknown;
    let input: Record<string, unknown> | null = null;
    let started = false;
    let nextEvents = 0;
    const client = {
      async prepare(value: unknown) { plan = value; return { executionId: "run", status: "prepared", cleanup: "pending" }; },
      async putInput(_id: string, slot: string, bytes: Uint8Array) {
        expect(slot).toBe("curl-config");
        input = JSON.parse(Buffer.from(bytes).toString("utf8")) as Record<string, unknown>;
        return { executionId: "run", status: "prepared", cleanup: "pending" };
      },
      async start() { started = true; return { executionId: "run", status: "started", cleanup: "pending" }; },
      async readEvents(_id: string, cursor: number) {
        nextEvents += 1;
        const events = cursor < 0 ? [{ executionId: "run", sequence: 0, stream: "stdout" as const, line: "200 [redacted] [redacted] [redacted]" }] : [];
        return { executionId: "run", events, nextSequence: events.at(-1)?.sequence ?? cursor, hasMore: false };
      },
      async status() { return { executionId: "run", status: "finished" as const, stopReason: null, cleanup: "confirmed" as const, exitCode: 0 }; },
      async renewOwnership() { throw new Error("not expected"); },
      async cancel() { throw new Error("not expected"); },
    } as unknown as ExecutionBrokerClient;
    const grants: unknown[] = [];
    const service = new CurlBrokerExecutionService({
      loadConfiguration: async () => configuration,
      createClient: () => client,
      issueGrant: async (_configuration, value) => { grants.push(value); },
      sleep: async () => {},
    });
    const prepared = await service.prepare(
      "curl -X POST 'https://approved.test/path?token=query-canary' -H 'X-Worker: header-canary' --data-raw 'body-canary'",
      "https://approved.test/root",
      undefined,
    );
    const output: string[] = [];
    const exitCode = await prepared.execution.run((lines) => output.push(...lines), () => {}, () => {});

    expect(exitCode).toBe(0);
    expect(started).toBe(true);
    expect(nextEvents).toBe(2);
    expect(grants).toHaveLength(1);
    expect(grants[0]).toMatchObject({
      profileId: "public-curl-worker-v1",
      invocation: { argv: ["run", "/opt/nulltrace/workers/curl-worker.ts"] },
      origins: ["https://approved.test"],
    });
    expect(input).toMatchObject({
      targetUrl: "https://approved.test/path?token=query-canary",
      headers: ["X-Worker: header-canary"],
      bodyOperations: [{ kind: "data-raw", value: "body-canary" }],
    });
    expect(output).toEqual(["200 [redacted] [redacted] [redacted]"]);
  });

  test("cancels a staged input before start and confirms cleanup", async () => {
    let releaseInput!: () => void;
    let markInputPending!: () => void;
    const inputPending = new Promise<void>((resolve) => { markInputPending = resolve; });
    let started = false;
    const client = {
      async prepare() { return { executionId: "run", status: "prepared", cleanup: "pending" }; },
      async putInput() { markInputPending(); await new Promise<void>((resolve) => { releaseInput = resolve; }); return { executionId: "run", status: "prepared", cleanup: "pending" }; },
      async start() { started = true; return { executionId: "run", status: "started", cleanup: "pending" }; },
      async readEvents() { return { executionId: "run", events: [], nextSequence: -1, hasMore: false }; },
      async status() { return { executionId: "run", status: "finished" as const, stopReason: "cancelled" as const, cleanup: "confirmed" as const, exitCode: null }; },
      async renewOwnership() { throw new Error("not expected"); },
      async cancel() { releaseInput(); return { executionId: "run", status: "finished" as const, stopReason: "cancelled" as const, cleanup: "confirmed" as const, exitCode: null }; },
    } as unknown as ExecutionBrokerClient;
    const service = new CurlBrokerExecutionService({
      loadConfiguration: async () => configuration,
      createClient: () => client,
      issueGrant: async () => {},
      sleep: async () => {},
    });
    const prepared = await service.prepare("curl https://approved.test/path", "https://approved.test", undefined);
    const runPromise = prepared.execution.run(() => {}, () => {}, () => {});
    await inputPending;
    const cancellation = await prepared.execution.cancel();

    expect(cancellation.cleanup).toBe("confirmed");
    expect(await runPromise).toBe(0);
    expect(started).toBe(false);
  });

  test("cancels before run without requesting a grant later", async () => {
    let grants = 0;
    const service = new CurlBrokerExecutionService({
      loadConfiguration: async () => configuration,
      createClient: () => ({}) as ExecutionBrokerClient,
      issueGrant: async () => { grants += 1; },
      sleep: async () => {},
    });
    const prepared = await service.prepare("curl https://approved.test/path", "https://approved.test", undefined);

    expect((await prepared.execution.cancel()).cleanup).toBe("confirmed");
    expect(await prepared.execution.run(() => {}, () => {}, () => {})).toBe(0);
    expect(grants).toBe(0);
  });

  test("rejects authenticated cURL before it can request an admin grant", async () => {
    let grants = 0;
    const service = new CurlBrokerExecutionService({
      loadConfiguration: async () => configuration,
      createClient: () => { throw new Error("not expected"); },
      issueGrant: async () => { grants += 1; },
      sleep: async () => {},
    });
    await expect(service.prepare("curl https://approved.test", "https://approved.test", {
      form: { useAuthenticatedContext: true },
    })).rejects.toThrow("Authenticated cURL is unavailable");
    expect(grants).toBe(0);
  });

  test("confirms cleanup after a transport failure when broker cancellation is confirmed", async () => {
    let cancelCalls = 0;
    const client = {
      async prepare() { return { executionId: "run", status: "prepared", cleanup: "pending" }; },
      async putInput() { return { executionId: "run", status: "prepared", cleanup: "pending" }; },
      async start() { return { executionId: "run", status: "started", cleanup: "pending" }; },
      async readEvents() { throw new Error("transport disconnected"); },
      async status() { throw new Error("not expected"); },
      async renewOwnership() { throw new Error("not expected"); },
      async cancel() {
        cancelCalls += 1;
        return { executionId: "run", status: "finished" as const, stopReason: "cancelled" as const, cleanup: "confirmed" as const, exitCode: null };
      },
    } as unknown as ExecutionBrokerClient;
    const service = new CurlBrokerExecutionService({
      loadConfiguration: async () => configuration,
      createClient: () => client,
      issueGrant: async () => {},
      sleep: async () => {},
    });
    const prepared = await service.prepare("curl https://approved.test/path", "https://approved.test", undefined);

    await expect(prepared.execution.run(() => {}, () => {}, () => {})).rejects.toThrow("broker execution failed");
    expect((await prepared.execution.cancel()).cleanup).toBe("confirmed");
    expect(cancelCalls).toBe(1);
  });

  test("keeps cleanup pending after a transport failure when broker cannot confirm cancellation", async () => {
    const client = {
      async prepare() { return { executionId: "run", status: "prepared", cleanup: "pending" }; },
      async putInput() { return { executionId: "run", status: "prepared", cleanup: "pending" }; },
      async start() { return { executionId: "run", status: "started", cleanup: "pending" }; },
      async readEvents() { throw new Error("transport disconnected"); },
      async status() { throw new Error("not expected"); },
      async renewOwnership() { throw new Error("not expected"); },
      async cancel() { throw new Error("socket unavailable"); },
    } as unknown as ExecutionBrokerClient;
    const service = new CurlBrokerExecutionService({
      loadConfiguration: async () => configuration,
      createClient: () => client,
      issueGrant: async () => {},
      sleep: async () => {},
    });
    const prepared = await service.prepare("curl https://approved.test/path", "https://approved.test", undefined);

    await expect(prepared.execution.run(() => {}, () => {}, () => {})).rejects.toThrow("broker execution failed");
    expect((await prepared.execution.cancel()).cleanup).toBe("pending");
  });
});
