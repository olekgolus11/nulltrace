import { describe, expect, test } from "bun:test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { ExecutionBrokerLockService } from "../execution-broker-lock.service";

describe("broker installation lock", () => {
  test("allows only one live broker for a private installation path", async () => {
    const directory = await mkdtemp(join(tmpdir(), "nulltrace-lock-"));
    try {
      const path = join(directory, "broker-lock.sqlite");
      const first = new ExecutionBrokerLockService(path);
      try {
        expect(() => new ExecutionBrokerLockService(path)).toThrow("Another execution broker");
      } finally {
        first.release();
      }
      expect(() => first.assertHeld()).toThrow("released");
      const replacement = new ExecutionBrokerLockService(path);
      replacement.release();
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  });
});
