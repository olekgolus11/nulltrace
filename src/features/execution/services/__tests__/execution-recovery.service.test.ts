import { describe, expect, test } from "bun:test";
import { Database } from "bun:sqlite";
import { ExecutionRecoveryService } from "../execution-recovery.service";
import { ExecutionReceiptRepository } from "../execution-receipt.repository";

describe("execution recovery", () => {
  test("keeps the broker locked until installation-owned resources are removed", async () => {
    const database = new Database(":memory:");
    const receipts = new ExecutionReceiptRepository(database, new Uint8Array(32).fill(7));
    receipts.reserve("owner", "run-1", "plan-fingerprint");
    receipts.commitStart("run-1");
    receipts.recordOutcome({ executionId: "run-1", cause: "infrastructure", exitCode: null, cleanup: "pending" });
    let unavailable = true;
    const recovery = new ExecutionRecoveryService(receipts, {
      async reconcileOwnedResources() {
        if (unavailable) throw new Error("engine unavailable");
      },
    });
    await expect(recovery.reconcile()).rejects.toThrow("engine unavailable");
    expect(receipts.hasInterrupted()).toBe(true);
    expect(receipts.find("run-1")?.cleanup).toBe("pending");
    unavailable = false;
    expect(await recovery.reconcile()).toBe(1);
    expect(receipts.find("run-1")).toMatchObject({ status: "closed", cleanup: "confirmed" });
    expect(receipts.findOutcome("run-1")?.cleanup).toBe("confirmed");
    expect(receipts.hasInterrupted()).toBe(false);
    expect(await recovery.reconcile()).toBe(0);
    database.close();
  });

  test("persists a bounded nonsecret outcome atomically with cleanup acknowledgement", () => {
    const database = new Database(":memory:");
    const receipts = new ExecutionReceiptRepository(database, new Uint8Array(32).fill(7));
    receipts.reserve("owner", "run-1", "plan-fingerprint");
    receipts.commitStart("run-1");
    receipts.recordOutcome({ executionId: "run-1", cause: "normal", exitCode: 0, cleanup: "confirmed" });
    expect(receipts.find("run-1")).toMatchObject({ status: "closed", cleanup: "confirmed" });
    expect(receipts.findOutcome("run-1")).toEqual({ executionId: "run-1", cause: "normal", exitCode: 0, cleanup: "confirmed" });
    expect(() => receipts.recordOutcome({ executionId: "run-1", cause: "normal", exitCode: 0, cleanup: "confirmed" })).toThrow();
    database.close();
  });
});
