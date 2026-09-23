import { describe, expect, test } from "bun:test";
import { Database } from "bun:sqlite";
import { ExecutionPlan } from "../../types/execution-plan.types";
import { HttpExecutionNetworkPolicy } from "../../types/http-execution-network.types";
import { HttpExecutionSupervisedNetwork } from "../../types/http-execution-supervisor.types";
import { HttpExecutionRunError } from "../http-execution-run.error";
import { HttpExecutionSupervisorService } from "../http-execution-supervisor.service";
import { ExecutionReceiptRepository } from "../execution-receipt.repository";
import { toExecutionOutcome } from "../execution-outcome.helpers";

const plan: ExecutionPlan = {
  version: 1,
  executionId: "run-1",
  authorizationId: "approval-1",
  profileId: "public-http",
  tool: "curl",
  mode: "public",
  invocation: { executableId: "curl", argv: ["https://example.test"] },
  origins: ["https://example.test"],
  inputs: [],
  limits: {
    timeoutMs: 500,
    memoryBytes: 128 * 1024 * 1024,
    cpuMilliCores: 500,
    processCount: 48,
    scratchBytes: 32 * 1024 * 1024,
    fileBytes: 8 * 1024 * 1024,
    outputBytes: 1024,
  },
};
const policy: HttpExecutionNetworkPolicy = {
  executionId: "run-1",
  origins: ["https://example.test"],
  endpoints: [{ origin: "https://example.test", hostname: "example.test", address: "93.184.216.34", family: 4, port: 443 }],
};

function fixture(leaseMs = 100) {
  const calls: AbortSignal[] = [];
  const network: HttpExecutionSupervisedNetwork = {
    async run(_policy, _limits, _executable, _argv, signal) {
      calls.push(signal!);
      await new Promise<void>((_, reject) => {
        signal!.addEventListener("abort", () => reject(new HttpExecutionRunError("cancelled", true)), { once: true });
      });
      throw new Error("Unreachable.");
    },
  };
  const supervisor = new HttpExecutionSupervisorService(network, {
    async resolve() { return policy; },
  }, { leaseMs, onSettled() {} });
  return { supervisor, calls };
}

describe("HTTP execution ownership", () => {
  test("cancels an active run and waits for verified environment cleanup", async () => {
    const { supervisor, calls } = fixture();
    await supervisor.start(plan);
    expect(supervisor.get("run-1").cleanup).toBe("pending");
    supervisor.cancel("run-1");
    const result = await supervisor.wait("run-1");
    expect(calls).toHaveLength(1);
    expect(calls[0]!.aborted).toBe(true);
    expect(result).toMatchObject({ status: "finished", stopReason: "cancelled", cleanup: "confirmed" });
  });

  test("expires an ownership lease and refuses revival", async () => {
    const { supervisor } = fixture(100);
    await supervisor.start(plan);
    expect(await supervisor.wait("run-1")).toMatchObject({ stopReason: "lease_expired", cleanup: "confirmed" });
    expect(() => supervisor.renewOwnership("run-1")).toThrow();
  });

  test("renewal never extends the absolute execution deadline", async () => {
    const { supervisor } = fixture(100);
    await supervisor.start({ ...plan, limits: { ...plan.limits, timeoutMs: 180 } });
    await Bun.sleep(60);
    expect(supervisor.renewOwnership("run-1").status).toBe("running");
    await Bun.sleep(60);
    expect(supervisor.renewOwnership("run-1").status).toBe("running");
    expect(await supervisor.wait("run-1")).toMatchObject({ stopReason: "deadline", cleanup: "confirmed" });
  });

  test("rejects a second run until the first cleanup is confirmed", async () => {
    const { supervisor } = fixture();
    await supervisor.start(plan);
    await expect(supervisor.start({ ...plan, executionId: "run-2" })).rejects.toThrow("busy");
    supervisor.cancel("run-1");
    await supervisor.wait("run-1");
    await supervisor.start({ ...plan, executionId: "run-2" });
    supervisor.cancel("run-2");
    await supervisor.wait("run-2");
  });

  test("keeps the backend locked after failed cleanup", async () => {
    const supervisor = new HttpExecutionSupervisorService({
      async run() { throw new HttpExecutionRunError("cleanup unavailable", false); },
    }, {
      async resolve() { return policy; },
    }, { leaseMs: 100, onSettled() {} });
    await supervisor.start(plan);
    expect(await supervisor.wait("run-1")).toMatchObject({ status: "interrupted", cleanup: "pending" });
    await expect(supervisor.start({ ...plan, executionId: "run-2" })).rejects.toThrow("busy");
  });

  test("marks a resolution failure clean because no environment was provisioned", async () => {
    let networkCalls = 0;
    const supervisor = new HttpExecutionSupervisorService({
      async run() { networkCalls++; throw new Error("unexpected invocation"); },
    }, {
      async resolve() { throw new Error("DNS failed"); },
    }, { leaseMs: 100, onSettled() {} });
    await supervisor.start(plan);
    expect(await supervisor.wait("run-1")).toMatchObject({ status: "finished", cleanup: "confirmed" });
    expect(networkCalls).toBe(0);
  });

  test("commits a public result summary after verified cleanup", async () => {
    const database = new Database(":memory:");
    try {
      const receipts = new ExecutionReceiptRepository(database, new Uint8Array(32).fill(7));
      receipts.reserve("owner", "run-1", "plan-fingerprint");
      receipts.commitStart("run-1");
      const supervisor = new HttpExecutionSupervisorService({
        async run() {
          return {
            command: { exitCode: 0, stdout: "untrusted output", stderr: "" },
            evidence: { executionId: "run-1", workerRulesSha256: "", proxyRulesSha256: "", proxyDecisions: [], cleanupConfirmed: true },
          };
        },
      }, { async resolve() { return policy; } }, {
        leaseMs: 100,
        onSettled(run) { receipts.recordOutcome(toExecutionOutcome(run)); },
      });
      await supervisor.start(plan);
      expect(await supervisor.wait("run-1")).toMatchObject({ status: "finished", cleanup: "confirmed", exitCode: 0 });
      expect(receipts.find("run-1")).toMatchObject({ status: "closed", cleanup: "confirmed" });
      expect(receipts.findOutcome("run-1")).toMatchObject({ cause: "normal", exitCode: 0 });
      expect(JSON.stringify(receipts.findOutcome("run-1"))).not.toContain("untrusted output");
    } finally {
      database.close();
    }
  });

  test("blocks another start until a failed durable settlement is retried", async () => {
    let available = false;
    const supervisor = new HttpExecutionSupervisorService({
      async run() {
        return {
          command: { exitCode: 0, stdout: "", stderr: "" },
          evidence: { executionId: "run-1", workerRulesSha256: "", proxyRulesSha256: "", proxyDecisions: [], cleanupConfirmed: true },
        };
      },
    }, { async resolve() { return policy; } }, {
      leaseMs: 100,
      onSettled() { if (!available) throw new Error("journal unavailable"); },
    });
    await supervisor.start(plan);
    expect(await supervisor.wait("run-1")).toMatchObject({ status: "interrupted", cleanup: "confirmed" });
    await expect(supervisor.start({ ...plan, executionId: "run-2" })).rejects.toThrow("busy");
    available = true;
    expect(await supervisor.retrySettlement("run-1")).toMatchObject({ status: "finished", cleanup: "confirmed" });
    await supervisor.start({ ...plan, executionId: "run-2" });
    await supervisor.wait("run-2");
  });
});
