import { afterEach, describe, expect, test } from "bun:test";
import { chmod, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { loadExecutionBrokerClientConfiguration } from "../execution-broker-client-config.helpers";

const directories: string[] = [];
afterEach(async () => {
  await Promise.all(directories.splice(0).map((directory) => rm(directory, { recursive: true, force: true })));
});

async function createClientDirectory(): Promise<string> {
  const directory = await mkdtemp(join(tmpdir(), "nulltrace-broker-client-"));
  directories.push(directory);
  await chmod(directory, 0o700);
  const files: Array<[string, string | Buffer]> = [
    ["broker-daemon.json", JSON.stringify({
      version: 1,
      installationId: "installation-test",
      instanceId: "instance-test",
      dockerExecutable: "/usr/local/bin/docker",
      images: { worker: `sha256:${"a".repeat(64)}`, proxy: `sha256:${"b".repeat(64)}`, initializer: `sha256:${"c".repeat(64)}` },
      trustedNonPublicMappings: {},
    })],
    ["client.token", "a".repeat(64)],
    ["admin.token", "b".repeat(64)],
  ];
  await Promise.all(files.map(async ([name, contents]) => {
    const path = join(directory, name);
    await writeFile(path, contents, { mode: 0o600 });
    await chmod(path, 0o600);
  }));
  return directory;
}

describe("execution broker client configuration", () => {
  test("reads only the private app identity and socket tokens", async () => {
    const directory = await createClientDirectory();

    const configuration = await loadExecutionBrokerClientConfiguration(directory);

    expect(configuration).toEqual({
      directory,
      principal: { installationId: "installation-test", instanceId: "instance-test" },
      clientToken: "a".repeat(64),
      adminToken: "b".repeat(64),
    });
  });

  test("accepts a validated private reservation field without exposing it as client authority", async () => {
    const directory = await createClientDirectory();
    const manifestPath = join(directory, "broker-daemon.json");
    const manifest = JSON.parse(await Bun.file(manifestPath).text()) as Record<string, unknown>;
    await writeFile(manifestPath, JSON.stringify({
      ...manifest,
      reservedControlEndpoints: [{ addresses: ["192.168.1.20"], port: 8443 }],
    }), { mode: 0o600 });
    await chmod(manifestPath, 0o600);

    const configuration = await loadExecutionBrokerClientConfiguration(directory);
    expect(configuration).not.toHaveProperty("reservedControlEndpoints");

    await writeFile(manifestPath, JSON.stringify({ ...manifest, reservedControlEndpoints: null }), { mode: 0o600 });
    await chmod(manifestPath, 0o600);
    await expect(loadExecutionBrokerClientConfiguration(directory)).rejects.toThrow("invalid");
  });

  test("reports actionable advice for an unprovisioned broker directory", async () => {
    const directory = await mkdtemp(join(tmpdir(), "nulltrace-broker-empty-"));
    directories.push(directory);
    await chmod(directory, 0o700);

    await expect(loadExecutionBrokerClientConfiguration(directory)).rejects.toThrow("NULLTRACE_EXECUTION_BROKER_DIR");
  });
});
