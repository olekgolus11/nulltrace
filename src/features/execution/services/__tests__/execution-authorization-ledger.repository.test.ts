import { describe, expect, test } from "bun:test";
import { Database } from "bun:sqlite";
import { chmod, mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { ExecutionAuthorizationLedgerRepository } from "../execution-authorization-ledger.repository";
import { ExecutionPlan, ExecutionProfile } from "../../types/execution-plan.types";

const principal = { installationId: "installation", instanceId: "operator" };
const key = new Uint8Array(32).fill(9);
const limits = { timeoutMs: 1000, memoryBytes: 1024, cpuMilliCores: 100, processCount: 4, scratchBytes: 1024, fileBytes: 512, outputBytes: 512 };
const profile: ExecutionProfile = {
  id: "public-curl-v1", tool: "curl", mode: "public", executableIds: ["curl"], inputs: [],
  maximumLimits: limits,
};
const plan: ExecutionPlan = {
  version: 1, executionId: "run-1", authorizationId: "grant-1", profileId: profile.id,
  tool: "curl", mode: "public", invocation: { executableId: "curl", argv: ["https://example.test"] },
  origins: ["https://example.test"], inputs: [], limits,
};

describe("execution authorization ledger", () => {
  test("binds one durable grant to one exact plan and execution across repository restarts", async () => {
    const directory = await mkdtemp(join(tmpdir(), "nulltrace-auth-ledger-"));
    const path = join(directory, "ledger.sqlite");
    let now = 1000;
    try {
      await chmod(directory, 0o700);
      const firstDatabase = new Database(path, { create: true });
      const first = new ExecutionAuthorizationLedgerRepository(firstDatabase, key, [profile], () => now);
      first.issue(principal, plan, 2000);
      const nextPlan = { ...plan, executionId: "run-2", authorizationId: "grant-2" };
      first.issue(principal, nextPlan, 2000);
      expect(first.claim(principal, "grant-1", plan)?.plan).toEqual(plan);
      expect(first.claim(principal, "grant-1", plan)?.plan).toEqual(plan);
      expect(first.claim(principal, "grant-1", { ...plan, executionId: "run-2" })).toBeNull();
      expect(first.claim(principal, "grant-2", nextPlan)?.plan).toEqual(nextPlan);
      firstDatabase.close();

      const restartedDatabase = new Database(path, { readwrite: true, create: false });
      const restarted = new ExecutionAuthorizationLedgerRepository(restartedDatabase, key, [profile], () => now);
      expect(restarted.claim(principal, "grant-1", plan)?.plan).toEqual(plan);
      now = 2000;
      expect(restarted.claim(principal, "grant-1", plan)).toBeNull();
      restartedDatabase.close();
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  });

  test("fails closed when a signed grant record is modified", () => {
    const database = new Database(":memory:");
    try {
      const ledger = new ExecutionAuthorizationLedgerRepository(database, key, [profile], () => 1000);
      ledger.issue(principal, plan, 2000);
      database.query("UPDATE execution_authorizations SET plan = ? WHERE authorization_id = ?")
        .run(JSON.stringify({ ...plan, invocation: { executableId: "curl", argv: ["https://other.test"] } }), "grant-1");
      expect(ledger.claim(principal, "grant-1", plan)).toBeNull();
    } finally {
      database.close();
    }
  });

  test("rejects non-finite, expired, overlong, and duplicate grant expiries", () => {
    const database = new Database(":memory:");
    try {
      const ledger = new ExecutionAuthorizationLedgerRepository(database, key, [profile], () => 1000);
      for (const expiresAt of [Number.NaN, Number.POSITIVE_INFINITY, 1000, 16 * 60_000 + 1000]) {
        expect(() => ledger.issue(principal, plan, expiresAt)).toThrow("Invalid execution authorization grant");
      }
      expect(ledger.issue(principal, plan, 2000)).toBe(true);
      expect(ledger.issue(principal, plan, 2000)).toBe(false);
    } finally {
      database.close();
    }
  });
});
