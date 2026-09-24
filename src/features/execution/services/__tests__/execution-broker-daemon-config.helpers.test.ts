import { describe, expect, test } from "bun:test";
import { Database } from "bun:sqlite";
import { chmod, lstat, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { ExecutionBrokerClient } from "../execution-broker-client.service";
import { loadExecutionBrokerDaemonConfiguration } from "../execution-broker-daemon-config.helpers";
import { provisionExecutionBrokerJournal } from "../execution-broker-journal.helpers";
import { ExecutionPlan } from "../../types/execution-plan.types";

const token = "a".repeat(64);
const key = new Uint8Array(32).fill(7);
const plan: ExecutionPlan = {
  version: 1, executionId: "run-1", authorizationId: "approval-1", profileId: "public-curl-v1",
  tool: "curl", mode: "public",
  invocation: { executableId: "curl", argv: ["--silent", "--show-error", "--fail", "--max-time", "5", "https://example.test/path"] },
  origins: ["https://example.test"], inputs: [],
  limits: {
    timeoutMs: 10_000, memoryBytes: 128 * 1024 * 1024, cpuMilliCores: 500,
    processCount: 48, scratchBytes: 32 * 1024 * 1024, fileBytes: 8 * 1024 * 1024, outputBytes: 1_024,
  },
};

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
    approvedPlan: plan,
    expiresAt: Date.now() + 60_000,
  };
  const writePrivate = async (name: string, content: string | Uint8Array) => {
    const path = join(directory, name);
    await writeFile(path, content, { mode: 0o600 });
    await chmod(path, 0o600);
  };
  await writePrivate("broker-daemon.json", JSON.stringify(manifest));
  await writePrivate("broker.key", key);
  await writePrivate("client.token", token);
  const database = new Database(join(directory, "receipts.sqlite"), { create: true });
  provisionExecutionBrokerJournal(database, manifest.installationId, key);
  database.close();
  await chmod(join(directory, "receipts.sqlite"), 0o600);
  return { directory, manifest, writePrivate };
}

describe("private broker daemon configuration", () => {
  test("loads a fixed public profile and exact approved plan from private files", async () => {
    const { directory } = await fixture();
    try {
      const startup = await loadExecutionBrokerDaemonConfiguration(directory);
      expect(startup.hostOptions.profiles.map((profile) => profile.id)).toEqual(["public-curl-v1"]);
      expect(startup.hostOptions.hmacKey).toEqual(key);
      expect(startup.hostOptions.readAuthorization({ installationId: "installation", instanceId: "instance" }, "approval-1")?.plan)
        .toEqual(plan);
      expect(startup.hostOptions.readAuthorization({ installationId: "installation", instanceId: "other" }, "approval-1"))
        .toBeNull();
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  });

  test("rejects an unsafe file, unsupported command, and secret-bearing URL", async () => {
    const { directory, manifest, writePrivate } = await fixture();
    try {
      await chmod(join(directory, "client.token"), 0o644);
      await expect(loadExecutionBrokerDaemonConfiguration(directory)).rejects.toThrow("not private");
      await chmod(join(directory, "client.token"), 0o600);
      await writePrivate("broker-daemon.json", JSON.stringify({
        ...manifest, approvedPlan: { ...plan, invocation: { executableId: "curl", argv: ["--header", "Authorization: secret", "https://example.test"] } },
      }));
      await expect(loadExecutionBrokerDaemonConfiguration(directory)).rejects.toThrow("Unsupported public cURL invocation");
      await writePrivate("broker-daemon.json", JSON.stringify({
        ...manifest, approvedPlan: { ...plan, invocation: { ...plan.invocation, argv: [...plan.invocation.argv.slice(0, -1), "https://example.test/path?token=secret"] } },
      }));
      await expect(loadExecutionBrokerDaemonConfiguration(directory)).rejects.toThrow("private URL fields");
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
    try {
      let ready = false;
      for (let attempt = 0; attempt < 100; attempt++) {
        const socketStat = await lstat(socket).catch(() => null);
        if (socketStat?.isSocket()) { ready = true; break; }
        if (child.exitCode !== null) break;
        await Bun.sleep(50);
      }
      expect(ready).toBe(true);
      expect((await lstat(socket)).mode & 0o777).toBe(0o600);
      const client = new ExecutionBrokerClient((request) => fetch(request, { unix: socket }), token);
      expect((await client.prepare(plan)).status).toBe("prepared");
      child.kill("SIGTERM");
      expect(await child.exited).toBe(0);
      await expect(lstat(socket)).rejects.toMatchObject({ code: "ENOENT" });
    } finally {
      child.kill("SIGKILL");
      await child.exited;
      await rm(directory, { recursive: true, force: true });
    }
  }, 15_000);
});
