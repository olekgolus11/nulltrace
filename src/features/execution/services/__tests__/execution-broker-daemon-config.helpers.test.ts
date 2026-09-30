import { describe, expect, test } from "bun:test";
import { Database } from "bun:sqlite";
import { chmod, lstat, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { ExecutionBrokerClient } from "../execution-broker-client.service";
import { ExecutionBrokerHostService } from "../execution-broker-host.service";
import { loadExecutionBrokerDaemonConfiguration } from "../execution-broker-daemon-config.helpers";
import { provisionExecutionBrokerJournal } from "../execution-broker-journal.helpers";
import { HttpExecutionResolverService } from "../http-execution-resolver.service";
import { ExecutionAuthorizationLedgerRepository } from "../execution-authorization-ledger.repository";
import { parseExecutionPlan } from "../execution-plan.helpers";

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
      expect(startup.hostOptions.reservedControlEndpoints).toEqual([]);
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
        limits: { ...plan.limits, outputBytes: 384 * 1024 },
      };
      expect(startup.hostOptions.authorizationPlanValidator?.(workerPlan)).toBe(true);
      expect(parseExecutionPlan(workerPlan, startup.hostOptions.profiles)).toEqual(workerPlan);
      expect(startup.hostOptions.authorizationPlanValidator?.({
        ...workerPlan,
        limits: { ...workerPlan.limits, outputBytes: 1_024 },
      })).toBe(false);
      expect(() => parseExecutionPlan({
        ...workerPlan,
        limits: { ...workerPlan.limits, outputBytes: 1_024 },
      }, startup.hostOptions.profiles)).toThrow("profile minimum");
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

  test("loads, validates, and snapshots private manifest endpoint reservations", async () => {
    const { directory, manifest, writePrivate } = await fixture();
    try {
      const addresses = ["192.168.1.20", "2001:4860:0:0:0:0:0:8888"];
      const configured = {
        ...manifest,
        trustedNonPublicMappings: { "target.test": ["192.168.1.20"] },
        reservedControlEndpoints: [{ addresses, port: 8443 }],
      };
      await writePrivate("broker-daemon.json", JSON.stringify(configured));
      const startup = await loadExecutionBrokerDaemonConfiguration(directory);
      expect(startup.hostOptions.trustedNonPublicMappings).toEqual({ "target.test": ["192.168.1.20"] });
      expect(startup.hostOptions.reservedControlEndpoints).toEqual([{
        addresses: ["192.168.1.20", "2001:4860::8888"], port: 8443,
      }]);
      expect(Object.isFrozen(startup.hostOptions.reservedControlEndpoints)).toBe(true);
      const snapshotAddresses = startup.hostOptions.reservedControlEndpoints?.[0]?.addresses;
      expect(Object.isFrozen(snapshotAddresses)).toBe(true);
      expect(Reflect.set(snapshotAddresses!, "0", "192.168.1.21")).toBe(false);
      expect(startup.hostOptions.reservedControlEndpoints?.[0]?.addresses[0]).toBe("192.168.1.20");

      const invalidReservations: unknown[] = [
        null,
        [{ addresses: ["192.168.1.20"], port: 0 }],
        [{ addresses: ["192.168.1.20"], port: 65_536 }],
        [{ addresses: ["192.168.1.20"], port: 8443, extra: true }],
        [{ addresses: [], port: 8443 }],
        [{ addresses: ["::ffff:192.168.1.20"], port: 8443 }],
        Array.from({ length: 9 }, () => ({ addresses: ["192.168.1.20"], port: 8443 })),
      ];
      for (const reservedControlEndpoints of invalidReservations) {
        await writePrivate("broker-daemon.json", JSON.stringify({ ...manifest, reservedControlEndpoints }));
        await expect(loadExecutionBrokerDaemonConfiguration(directory)).rejects.toThrow();
      }
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  });

  test("loaded reservation blocks a trusted alias before Docker while another port reaches Docker", async () => {
    const { directory, manifest, writePrivate } = await fixture();
    const address = "192.168.1.20";
    const port = 8443;
    const configured = {
      ...manifest,
      trustedNonPublicMappings: { "reserved-alias.test": [address], "alternate-port.test": [address] },
      reservedControlEndpoints: [{ addresses: [address], port }],
    };
    await writePrivate("broker-daemon.json", JSON.stringify(configured));
    const startup = await loadExecutionBrokerDaemonConfiguration(directory);
    const socket = join(directory, "broker.sock");
    const adminSocket = join(directory, "broker-admin.sock");
    let dockerCalls = 0;
    let networkCreateCalls = 0;
    const host = new ExecutionBrokerHostService({
      ...startup.hostOptions,
      docker: {
        async run(args) {
          dockerCalls++;
          if (args[0] === "network" && args[1] === "create") {
            networkCreateCalls++;
            return { exitCode: 1, stdout: "", stderr: "fixture stops before provisioning" };
          }
          return { exitCode: 0, stdout: "", stderr: "" };
        },
      },
      async lookup(hostname) {
        if (hostname !== "reserved-alias.test" && hostname !== "alternate-port.test") {
          throw new Error("Unexpected fixture hostname.");
        }
        return [{ address, family: 4 }];
      },
    });
    try {
      const resolver = new HttpExecutionResolverService({
        trustedNonPublicMappings: startup.hostOptions.trustedNonPublicMappings,
        reservedControlEndpoints: startup.hostOptions.reservedControlEndpoints,
        async lookup(hostname) {
          if (hostname !== "reserved-alias.test" && hostname !== "alternate-port.test") {
            throw new Error("Unexpected fixture hostname.");
          }
          return [{ address, family: 4 }];
        },
      });
      await expect(resolver.resolve("reserved-preflight", [`https://reserved-alias.test:${port}`]))
        .rejects.toThrow("reserved control endpoint");
      await host.start();
      const client = new ExecutionBrokerClient((request) => fetch(request, { unix: socket }), token);
      const principal = { installationId: "installation", instanceId: "instance" };
      const makePlan = (executionId: string, authorizationId: string, hostname: string, targetPort: number) => {
        const origin = `https://${hostname}:${targetPort}`;
        return {
          ...plan,
          executionId,
          authorizationId,
          invocation: {
            executableId: "curl",
            argv: ["--silent", "--show-error", "--fail", "--max-time", "5", `${origin}/path`],
          },
          origins: [origin],
        };
      };
      const issueAndPrepare = async (candidate: typeof plan) => {
        const response = await fetch("http://localhost/v1/grants", {
          unix: adminSocket,
          method: "POST",
          headers: { authorization: `Bearer ${adminToken}`, "content-type": "application/json" },
          body: JSON.stringify({ principal, plan: candidate, expiresAt: Date.now() + 60_000 }),
        });
        expect(response.status).toBe(201);
        expect((await client.prepare(candidate)).status).toBe("prepared");
      };

      const reservedPlan = makePlan("reserved-run", "reserved-grant", "reserved-alias.test", port);
      await issueAndPrepare(reservedPlan);
      dockerCalls = 0;
      await client.start(reservedPlan.executionId);
      let reservedStatus = await client.status(reservedPlan.executionId);
      for (let attempt = 0; attempt < 50 && reservedStatus.cleanup !== "confirmed"; attempt++) {
        await Bun.sleep(20);
        reservedStatus = await client.status(reservedPlan.executionId);
      }
      expect(reservedStatus.status).toBe("finished");
      expect(reservedStatus.cleanup).toBe("confirmed");
      expect(dockerCalls).toBe(0);
      expect(networkCreateCalls).toBe(0);

      const alternatePlan = makePlan("alternate-run", "alternate-grant", "alternate-port.test", port + 1);
      await issueAndPrepare(alternatePlan);
      dockerCalls = 0;
      await client.start(alternatePlan.executionId);
      let alternateStatus = await client.status(alternatePlan.executionId);
      for (let attempt = 0; attempt < 50 && alternateStatus.cleanup !== "confirmed"; attempt++) {
        await Bun.sleep(20);
        alternateStatus = await client.status(alternatePlan.executionId);
      }
      expect(alternateStatus.status).toBe("finished");
      expect(alternateStatus.cleanup).toBe("confirmed");
      expect(alternateStatus.exitCode).toBeNull();
      expect(networkCreateCalls).toBeGreaterThan(0);
    } finally {
      await host.close();
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
      expect((await sendGrant({ ...grant, reservedControlEndpoints: [] }, adminToken)).status).toBe(400);
      expect((await sendGrant({ ...grant, plan: { ...secondPlan, reservedControlEndpoints: [] } }, adminToken)).status).toBe(400);
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
