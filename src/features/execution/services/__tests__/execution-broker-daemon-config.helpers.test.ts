import { describe, expect, test } from "bun:test";
import { Database } from "bun:sqlite";
import { chmod, lstat, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { ExecutionBrokerClient } from "../execution-broker-client.service";
import { loadExecutionBrokerDaemonConfiguration } from "../execution-broker-daemon-config.helpers";
import { provisionExecutionBrokerJournal } from "../execution-broker-journal.helpers";
import { ExecutionAuthorizationLedgerRepository } from "../execution-authorization-ledger.repository";

const plan = {
  version: 1 as const, executionId: "run-1", authorizationId: "approval-1", profileId: "public-curl-v1",
  tool: "curl", mode: "public",
  invocation: { executableId: "curl", argv: ["--silent", "--show-error", "--fail", "--max-time", "5", "https://example.test/path"] },
  origins: ["https://example.test"], inputs: [],
  limits: {
    timeoutMs: 10_000, memoryBytes: 128 * 1024 * 1024, cpuMilliCores: 500,
    processCount: 48, scratchBytes: 32 * 1024 * 1024, fileBytes: 8 * 1024 * 1024, outputBytes: 1_024,
  },
};

const token = "a".repeat(64);
const adminToken = "b".repeat(64);
const key = new Uint8Array(32).fill(7);
async function fixture() {
  const directory = await mkdtemp(join(tmpdir(), "nulltrace-daemon-"));
  await chmod(directory, 0o700);
  const manifest = {
    version: 1,
    installationId: "installation",
    instanceId: "instance",
    dockerExecutable: "/usr/bin/true",
    images: {
      worker: `sha256:${"a".repeat(64)}`,
      proxy: `sha256:${"b".repeat(64)}`,
      initializer: `sha256:${"c".repeat(64)}`,
    },
    trustedNonPublicMappings: {},
  };
  const writePrivate = async (name: string, content: string | Uint8Array) => {
    const path = join(directory, name);
    await writeFile(path, content, { mode: 0o600 });
    await chmod(path, 0o600);
  };
  await writePrivate("broker-daemon.json", JSON.stringify(manifest));
  await writePrivate("broker.key", key);
  await writePrivate("client.token", token);
  await writePrivate("admin.token", adminToken);
  const database = new Database(join(directory, "receipts.sqlite"), { create: true });
  provisionExecutionBrokerJournal(database, manifest.installationId, key);
  const profile = {
    id: "public-curl-v1", tool: "curl", mode: "public", executableIds: ["curl"], inputs: [],
    maximumLimits: {
      timeoutMs: 30_000, memoryBytes: 512 * 1024 * 1024, cpuMilliCores: 1_000,
      processCount: 128, scratchBytes: 64 * 1024 * 1024, fileBytes: 16 * 1024 * 1024, outputBytes: 1024 * 1024,
    },
  };
  new ExecutionAuthorizationLedgerRepository(database, key, [profile])
    .issue({ installationId: "installation", instanceId: "instance" }, plan, Date.now() + 60_000);
  database.close();
  await chmod(join(directory, "receipts.sqlite"), 0o600);
  return { directory, manifest, writePrivate };
}

describe("private broker daemon configuration", () => {
  test("loads fixed public profiles and enables the broker-owned authorization ledger", async () => {
    const { directory } = await fixture();
    try {
      const startup = await loadExecutionBrokerDaemonConfiguration(directory);
      expect(startup.hostOptions.profiles.map((profile) => profile.id)).toEqual(["public-curl-v1", "public-curl-worker-v1"]);
      expect(startup.hostOptions.publicDataEventProfileIds).toEqual(["public-curl-worker-v1"]);
      expect(startup.hostOptions.hmacKey).toEqual(key);
      expect(startup.hostOptions.adminToken).toBe(adminToken);
      expect(startup.hostOptions.adminToken).not.toBe(token);
      expect(startup.hostOptions.useAuthorizationLedger).toBe(true);
      expect(startup.hostOptions.authorizationPlanValidator?.({
        version: 1, executionId: "run", authorizationId: "approval", profileId: "public-curl-v1",
        tool: "curl", mode: "public", invocation: { executableId: "curl", argv: ["--header", "Authorization: secret"] },
        origins: [], inputs: [], limits: {
          timeoutMs: 1000, memoryBytes: 1024, cpuMilliCores: 100, processCount: 4,
          scratchBytes: 1024, fileBytes: 512, outputBytes: 512,
        },
      })).toBe(false);
      const workerPlan = {
        ...plan,
        profileId: "public-curl-worker-v1",
        mode: "public-worker",
        invocation: { executableId: "bun", argv: ["run", "/opt/nulltrace/workers/curl-worker.ts"] },
        inputs: [{ id: "curl-config", kind: "data" as const, maximumBytes: 2 * 1024 * 1024 }],
      };
      expect(startup.hostOptions.authorizationPlanValidator?.(workerPlan)).toBe(true);
      expect(startup.hostOptions.authorizationPlanValidator?.({
        ...workerPlan,
        invocation: { executableId: "bun", argv: ["run", "/opt/nulltrace/workers/curl-worker.ts", "https://other.test"] },
      })).toBe(false);
      expect(startup.hostOptions.authorizationPlanValidator?.({
        ...workerPlan,
        profileId: "public-curl-v1",
        invocation: plan.invocation,
      })).toBe(false);
      expect(startup.hostOptions.authorizationPlanValidator?.({
        ...plan, origins: [...plan.origins, "https://other.test"],
      })).toBe(false);
      expect(startup.hostOptions.readAuthorization({ installationId: "installation", instanceId: "instance" }, "approval-1"))
        .toBeNull();
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  });

  test("rejects unsafe files and static approvals in daemon configuration", async () => {
    const { directory, manifest, writePrivate } = await fixture();
    try {
      await chmod(join(directory, "client.token"), 0o644);
      await expect(loadExecutionBrokerDaemonConfiguration(directory)).rejects.toThrow("not private");
      await chmod(join(directory, "client.token"), 0o600);
      await writePrivate("broker-daemon.json", JSON.stringify({
        ...manifest, approvedPlan: { authorizationId: "approval-1" },
      }));
      await expect(loadExecutionBrokerDaemonConfiguration(directory)).rejects.toThrow("Unexpected execution fields");
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  });

  test("runs in a child process and removes its private socket on SIGTERM", async () => {
    const { directory } = await fixture();
    const script = join(import.meta.dir, "../../../../../infrastructure/isolation/run-broker.ts");
    const child = Bun.spawn([process.execPath, script, directory], {
      stdin: "ignore", stdout: "pipe", stderr: "pipe",
      env: { PATH: process.env.PATH ?? "/usr/bin:/bin", HOME: directory },
    });
    const socket = join(directory, "broker.sock");
    const adminSocket = join(directory, "broker-admin.sock");
    try {
      let ready = false;
      for (let attempt = 0; attempt < 100; attempt++) {
        const socketStat = await lstat(socket).catch(() => null);
        if (socketStat?.isSocket()) { ready = true; break; }
        if (child.exitCode !== null) break;
        await Bun.sleep(50);
      }
      expect(ready, ready ? "" : await new Response(child.stderr).text()).toBe(true);
      for (let attempt = 0; attempt < 100 && !(await lstat(adminSocket).catch(() => null))?.isSocket(); attempt++) await Bun.sleep(50);
      expect((await lstat(socket)).mode & 0o777).toBe(0o600);
      expect((await lstat(adminSocket)).mode & 0o777).toBe(0o600);
      const client = new ExecutionBrokerClient((request) => fetch(request, { unix: socket }), token);
      expect((await client.prepare(plan)).status).toBe("prepared");
      const sendGrant = (grant: unknown, credential: string, unix = adminSocket) => fetch("http://localhost/v1/grants", {
        unix, method: "POST", headers: { authorization: `Bearer ${credential}`, "content-type": "application/json" },
        body: JSON.stringify(grant),
      });
      const secondPlan = { ...plan, executionId: "run-2", authorizationId: "approval-2" };
      const principal = { installationId: "installation", instanceId: "instance" };
      const grant = { principal, plan: secondPlan, expiresAt: Date.now() + 60_000 };
      expect((await sendGrant(grant, token)).status).toBe(401);
      expect((await sendGrant(grant, token, adminSocket)).status).toBe(401);
      expect((await sendGrant(grant, adminToken, socket)).status).toBe(401);
      expect((await sendGrant({ ...grant, plan: { ...secondPlan, origins: [...plan.origins, "https://other.test"] } }, adminToken)).status).toBe(400);
      expect((await sendGrant({ ...grant, plan: { ...secondPlan, invocation: { ...plan.invocation, argv: [...plan.invocation.argv, "--proxy", "http://other.test"] } } }, adminToken)).status).toBe(400);
      expect((await sendGrant(grant, adminToken)).status).toBe(201);
      expect((await sendGrant(grant, adminToken)).status).toBe(409);
      child.kill("SIGTERM");
      expect(await child.exited).toBe(0);
      await expect(lstat(socket)).rejects.toMatchObject({ code: "ENOENT" });
      await expect(lstat(adminSocket)).rejects.toMatchObject({ code: "ENOENT" });
    } finally {
      child.kill("SIGKILL");
      await child.exited;
      await rm(directory, { recursive: true, force: true });
    }
  }, 15_000);
});
