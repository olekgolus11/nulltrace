import { describe, expect, test } from "bun:test";
import { randomBytes } from "node:crypto";
import { Database } from "bun:sqlite";
import { chmod, chown, link, lstat, mkdir, mkdtemp, readFile, rm, symlink, unlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { ExecutionBrokerInstallationService } from "../execution-broker-installation.service";
import { assertExecutionBrokerJournal } from "../execution-broker-journal.helpers";

async function createParent(): Promise<string> {
  return mkdtemp(join(tmpdir(), "nulltrace-broker-installation-"));
}

describe("ExecutionBrokerInstallationService", () => {
  test("creates a private keyed installation and returns stable credentials idempotently", async () => {
    const uid = process.getuid?.();
    if (uid === undefined) throw new Error("POSIX ownership is required for this test.");
    const parent = await createParent();
    const directory = join(parent, "broker");
    const service = new ExecutionBrokerInstallationService({ directory, installationId: "stable-installation" });
    try {
      const first = await service.provision();
      const firstKey = Buffer.from(first.hmacKey);
      const firstToken = first.clientToken;
      expect(firstKey.byteLength).toBe(32);
      expect(firstToken).toMatch(/^[a-f0-9]{64}$/);
      expect((await lstat(directory)).mode & 0o777).toBe(0o700);
      for (const [name, size] of [["broker.key", 32], ["client.token", 64], ["receipts.sqlite", undefined]] as const) {
        const stat = await lstat(join(directory, name));
        expect(stat.isFile()).toBe(true);
        expect(stat.isSymbolicLink()).toBe(false);
        expect(stat.nlink).toBe(1);
        expect(stat.mode & 0o777).toBe(0o600);
        expect(stat.uid).toBe(uid);
        if (size !== undefined) expect(stat.size).toBe(size);
      }
      const database = new Database(first.journalPath, { readonly: true, create: false });
      try { assertExecutionBrokerJournal(database, first.installationId, first.hmacKey); }
      finally { database.close(); }
      expect(await lstat(join(directory, "broker-provision.lock")).then(() => true).catch(() => false)).toBe(false);

      const second = await new ExecutionBrokerInstallationService({ directory, installationId: "stable-installation" }).provision();
      expect(second.hmacKey).toEqual(firstKey);
      expect(second.clientToken).toBe(firstToken);
      first.hmacKey.fill(0);
      second.hmacKey.fill(0);
    } finally {
      await rm(parent, { recursive: true, force: true });
    }
  });

  test("rejects partial state and preserves existing bytes", async () => {
    const parent = await createParent();
    const directory = join(parent, "broker");
    const sentinel = randomBytes(32);
    try {
      await mkdir(directory, { mode: 0o700 });
      await writeFile(join(directory, "broker.key"), sentinel, { mode: 0o600 });
      const service = new ExecutionBrokerInstallationService({ directory, installationId: "stable-installation" });
      await expect(service.provision()).rejects.toThrow("partial");
      expect(await readFile(join(directory, "broker.key"))).toEqual(sentinel);
      expect(await lstat(join(directory, "client.token")).then(() => true).catch(() => false)).toBe(false);
    } finally {
      sentinel.fill(0);
      await rm(parent, { recursive: true, force: true });
    }
  });

  test("rejects unsafe modes, linked credentials, sidecars and a stale provisioning lock", async () => {
    const parent = await createParent();
    const directory = join(parent, "broker");
    const service = new ExecutionBrokerInstallationService({ directory, installationId: "stable-installation" });
    try {
      const installation = await service.provision();
      const savedToken = installation.clientToken;
      const savedKey = Buffer.from(installation.hmacKey).toString("hex");
      installation.hmacKey.fill(0);
      const tokenPath = join(directory, "client.token");
      await chmod(tokenPath, 0o640);
      const modeFailure = await service.provision().then(() => "", (error: unknown) => error instanceof Error ? error.message : String(error));
      expect(modeFailure).toContain("not private");
      expect(modeFailure).not.toContain(savedToken);
      expect(modeFailure).not.toContain(savedKey);
      await chmod(tokenPath, 0o600);

      const wrongIdentityFailure = await new ExecutionBrokerInstallationService({ directory, installationId: "different-installation" })
        .provision().then(() => "", (error: unknown) => error instanceof Error ? error.message : String(error));
      expect(wrongIdentityFailure).toContain("identity mismatch");
      expect(wrongIdentityFailure).not.toContain(savedToken);

      const linkedToken = join(parent, "linked-token");
      await link(tokenPath, linkedToken);
      await expect(service.provision()).rejects.toThrow("not private");
      await unlink(linkedToken);

      const sidecar = join(directory, "receipts.sqlite-wal");
      await writeFile(sidecar, "stale", { mode: 0o600 });
      await expect(service.provision()).rejects.toThrow("sidecar");
      await unlink(sidecar);

      const staleLock = join(directory, "broker-provision.lock");
      await writeFile(staleLock, "", { mode: 0o600 });
      await expect(service.provision()).rejects.toMatchObject({ code: "EEXIST" });
      expect((await lstat(staleLock)).isFile()).toBe(true);
    } finally {
      await rm(parent, { recursive: true, force: true });
    }
  });

  test("rejects replaced symlinks and journals keyed with a different installation secret", async () => {
    const parent = await createParent();
    const directory = join(parent, "broker");
    const service = new ExecutionBrokerInstallationService({ directory, installationId: "stable-installation" });
    try {
      const original = await service.provision();
      const expectedKey = Buffer.from(original.hmacKey);
      original.hmacKey.fill(0);
      const keyPath = join(directory, "broker.key");
      const outsideKey = join(parent, "outside-key");
      await writeFile(outsideKey, expectedKey, { mode: 0o600 });
      await unlink(keyPath);
      await symlink(outsideKey, keyPath);
      await expect(service.provision()).rejects.toThrow();
      expect(await readFile(outsideKey)).toEqual(expectedKey);
      await unlink(keyPath);
      await writeFile(keyPath, expectedKey, { mode: 0o600 });
      await chmod(keyPath, 0o600);

      const journalPath = join(directory, "receipts.sqlite");
      await unlink(journalPath);
      const replacementKey = randomBytes(32);
      const replacement = new Database(journalPath, { create: true });
      try {
        const { provisionExecutionBrokerJournal } = await import("../execution-broker-journal.helpers");
        provisionExecutionBrokerJournal(replacement, "stable-installation", replacementKey);
      } finally { replacement.close(); }
      await chmod(journalPath, 0o600);
      await expect(service.provision()).rejects.toThrow("identity mismatch");
      replacementKey.fill(0);
      expectedKey.fill(0);
    } finally {
      await rm(parent, { recursive: true, force: true });
    }
  });

  test("rejects an existing directory with unsafe mode and a replaced directory symlink", async () => {
    expect(() => new ExecutionBrokerInstallationService({ directory: "relative/path", installationId: "stable-installation" }))
      .toThrow("must be absolute");
    const parent = await createParent();
    const unsafeDirectory = join(parent, "unsafe");
    const directory = join(parent, "broker");
    const replacement = join(parent, "replacement");
    try {
      await mkdir(unsafeDirectory, { mode: 0o700 });
      await chmod(unsafeDirectory, 0o755);
      await expect(new ExecutionBrokerInstallationService({ directory: unsafeDirectory, installationId: "stable-installation" }).provision())
        .rejects.toThrow("not private and owner-controlled");

      await mkdir(replacement, { mode: 0o700 });
      await symlink(replacement, directory);
      await expect(new ExecutionBrokerInstallationService({ directory, installationId: "stable-installation" }).provision())
        .rejects.toThrow("not private and owner-controlled");
      expect(await lstat(join(replacement, "broker.key")).then(() => true).catch(() => false)).toBe(false);
    } finally {
      await rm(parent, { recursive: true, force: true });
    }
  });

  test("serializes concurrent initial provisioning and keeps one stable installation", async () => {
    const parent = await createParent();
    const directory = join(parent, "broker");
    try {
      const first = new ExecutionBrokerInstallationService({ directory, installationId: "stable-installation" });
      const second = new ExecutionBrokerInstallationService({ directory, installationId: "stable-installation" });
      const results = await Promise.allSettled([first.provision(), second.provision()]);
      const installed = results.filter((result) => result.status === "fulfilled");
      expect(installed).toHaveLength(1);
      const retry = await new ExecutionBrokerInstallationService({ directory, installationId: "stable-installation" }).provision();
      if (installed[0]?.status === "fulfilled") {
        expect(retry.hmacKey).toEqual(installed[0].value.hmacKey);
        expect(retry.clientToken).toBe(installed[0].value.clientToken);
        installed[0].value.hmacKey.fill(0);
      }
      retry.hmacKey.fill(0);
    } finally {
      await rm(parent, { recursive: true, force: true });
    }
  });

  test("rejects an existing directory with the wrong owner when ownership can be changed", async () => {
    const uid = process.getuid?.();
    if (uid === undefined || uid === 0) return;
    const parent = await createParent();
    const directory = join(parent, "broker");
    try {
      const installation = await new ExecutionBrokerInstallationService({ directory, installationId: "stable-installation" }).provision();
      installation.hmacKey.fill(0);
      const foreignUid = uid === 1 ? 2 : uid + 1;
      const tokenPath = join(directory, "client.token");
      try {
        await chown(tokenPath, foreignUid, -1);
      } catch {
        return;
      }
      await expect(new ExecutionBrokerInstallationService({ directory, installationId: "stable-installation" }).provision())
        .rejects.toThrow("not private and owner-controlled");
    } finally {
      await chown(join(directory, "client.token"), uid, -1).catch(() => undefined);
      await rm(parent, { recursive: true, force: true });
    }
  });
});
