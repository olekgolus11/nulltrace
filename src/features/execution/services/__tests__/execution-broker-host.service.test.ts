import { describe, expect, test } from "bun:test";
import { Database } from "bun:sqlite";
import { chmod, link, lstat, mkdtemp, rm, symlink } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { ExecutionBrokerHostService } from "../execution-broker-host.service";
import { provisionExecutionBrokerJournal } from "../execution-broker-journal.helpers";
import { ExecutionReceiptRepository } from "../execution-receipt.repository";
import { ExecutionBrokerHostOptions } from "../../types/execution-broker-host.types";
import { ExecutionPlan, ExecutionProfile } from "../../types/execution-plan.types";

const limits = {
  timeoutMs: 1_000, memoryBytes: 128 * 1024 * 1024, cpuMilliCores: 500,
  processCount: 48, scratchBytes: 32 * 1024 * 1024, fileBytes: 8 * 1024 * 1024, outputBytes: 1_024,
};
const profile: ExecutionProfile = {
  id: "public-http", tool: "curl", mode: "public", executableIds: ["curl"], inputs: [], maximumLimits: limits,
};
const plan: ExecutionPlan = {
  version: 1, executionId: "run-1", authorizationId: "approval-1", profileId: profile.id,
  tool: "curl", mode: "public", invocation: { executableId: "curl", argv: ["https://example.test"] },
  origins: ["https://example.test"], inputs: [], limits,
};
const principal = { installationId: "installation", instanceId: "instance" };
const token = "a".repeat(64);
const image = `sha256:${"a".repeat(64)}`;

async function fixture() {
  const directory = await mkdtemp(join(tmpdir(), "nulltrace-broker-host-"));
  await chmod(directory, 0o700);
  const database = new Database(join(directory, "receipts.sqlite"), { create: true });
  provisionExecutionBrokerJournal(database, "installation", new Uint8Array(32).fill(7));
  database.close();
  await chmod(join(directory, "receipts.sqlite"), 0o600);
  const options: ExecutionBrokerHostOptions = {
    directory,
    installationId: "installation",
    hmacKey: new Uint8Array(32).fill(7),
    identities: [{ token, principal }],
    profiles: [profile],
    readAuthorization: () => ({ principal, plan, expiresAt: Date.now() + 60_000 }),
    images: { worker: image, proxy: image, initializer: image },
    trustedNonPublicMappings: {},
    docker: {
      async run() { return { exitCode: 0, stdout: "", stderr: "" }; },
    },
  };
  return { directory, options };
}

describe("private execution broker host", () => {
  test("serves approved admission only on a private Unix socket and removes it on shutdown", async () => {
    const { directory, options } = await fixture();
    const host = new ExecutionBrokerHostService(options);
    try {
      const unix = await host.start();
      expect((await lstat(unix)).mode & 0o777).toBe(0o600);
      const response = await fetch("http://localhost/v1/prepare", {
        unix, method: "POST", headers: { authorization: `Bearer ${token}`, "content-type": "application/json" },
        body: JSON.stringify(plan),
      });
      expect(response.status).toBe(200);
      expect(await response.json()).toMatchObject({ executionId: "run-1", status: "prepared" });
      const unauthorized = await fetch("http://localhost/v1/get", {
        unix, method: "POST", headers: { authorization: `Bearer ${"b".repeat(64)}`, "content-type": "application/json" },
        body: JSON.stringify({ executionId: "run-1" }),
      });
      expect(unauthorized.status).toBe(401);
      await host.close();
      await expect(lstat(unix)).rejects.toMatchObject({ code: "ENOENT" });
    } finally {
      await host.close();
      await rm(directory, { recursive: true, force: true });
    }
  });

  test("refuses a second live host without deleting the first host's socket", async () => {
    const { directory, options } = await fixture();
    const first = new ExecutionBrokerHostService(options);
    const second = new ExecutionBrokerHostService(options);
    try {
      const unix = await first.start();
      await expect(second.start()).rejects.toThrow("Another execution broker");
      expect((await lstat(unix)).isSocket()).toBe(true);
    } finally {
      await second.close();
      await first.close();
      await rm(directory, { recursive: true, force: true });
    }
  });

  test("rejects nonprivate journal and directory before opening a socket", async () => {
    const { directory, options } = await fixture();
    try {
      await chmod(join(directory, "receipts.sqlite"), 0o644);
      await expect(new ExecutionBrokerHostService(options).start()).rejects.toThrow("not private");
      await chmod(join(directory, "receipts.sqlite"), 0o600);
      await chmod(directory, 0o755);
      await expect(new ExecutionBrokerHostService(options).start()).rejects.toThrow("not private");
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  });

  test("fails closed on a replaced or wrong-key receipt journal", async () => {
    const { directory, options } = await fixture();
    try {
      await expect(new ExecutionBrokerHostService({ ...options, hmacKey: new Uint8Array(32).fill(9) }).start())
        .rejects.toThrow("identity mismatch");
      await rm(join(directory, "receipts.sqlite"));
      const replacement = new Database(join(directory, "receipts.sqlite"), { create: true });
      replacement.close();
      await chmod(join(directory, "receipts.sqlite"), 0o600);
      await expect(new ExecutionBrokerHostService(options).start()).rejects.toThrow("not provisioned");
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  });

  test("rejects linked broker paths", async () => {
    const { directory, options } = await fixture();
    const alias = `${directory}-alias`;
    try {
      await symlink(directory, alias);
      await expect(new ExecutionBrokerHostService({ ...options, directory: alias }).start())
        .rejects.toThrow("not private");
      await link(join(directory, "receipts.sqlite"), join(directory, "journal-copy"));
      await expect(new ExecutionBrokerHostService(options).start()).rejects.toThrow("not private");
    } finally {
      await rm(alias, { force: true });
      await rm(directory, { recursive: true, force: true });
    }
  });

  test("reconciles a committed orphan before opening admission", async () => {
    const { directory, options } = await fixture();
    const database = new Database(join(directory, "receipts.sqlite"), { readwrite: true, create: false });
    const receipts = new ExecutionReceiptRepository(database, options.hmacKey);
    receipts.reserve("previous-owner", "orphan-run", "plan-fingerprint");
    receipts.commitStart("orphan-run");
    database.close();
    const host = new ExecutionBrokerHostService(options);
    try {
      await host.start();
      const inspection = new Database(join(directory, "receipts.sqlite"), { readonly: true });
      expect(inspection.query<{ status: string; cleanup: string }, []>(
        "SELECT status, cleanup FROM execution_receipts WHERE execution_id = 'orphan-run'",
      ).get()).toEqual({ status: "closed", cleanup: "confirmed" });
      inspection.close();
    } finally {
      await host.close();
      await rm(directory, { recursive: true, force: true });
    }
  });

  test("does not listen when engine recovery is unavailable", async () => {
    const { directory, options } = await fixture();
    const host = new ExecutionBrokerHostService({
      ...options,
      docker: { async run() { return { exitCode: 1, stdout: "", stderr: "" }; } },
    });
    try {
      await expect(host.start()).rejects.toThrow("inventory is unavailable");
      await expect(lstat(join(directory, "broker.sock"))).rejects.toMatchObject({ code: "ENOENT" });
    } finally {
      await host.close();
      await rm(directory, { recursive: true, force: true });
    }
  });
});
