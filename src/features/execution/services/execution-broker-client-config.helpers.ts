import { constants } from "node:fs";
import { lstat, open } from "node:fs/promises";
import { isAbsolute, join, resolve } from "node:path";
import { ExecutionBrokerClientConfiguration } from "../types/execution-broker-client.types";

/** Reads only client identity and socket credentials; daemon secrets and image policy stay out of the app. */
export async function loadExecutionBrokerClientConfiguration(
  directory: string | undefined = process.env.NULLTRACE_EXECUTION_BROKER_DIR,
): Promise<ExecutionBrokerClientConfiguration> {
  if (!directory || !isAbsolute(directory) || directory.includes("\0")) {
    throw new Error("Isolated cURL broker is not configured. Set NULLTRACE_EXECUTION_BROKER_DIR to its private directory.");
  }
  const resolvedDirectory = resolve(directory);
  let manifestBytes: Buffer | undefined;
  let clientBytes: Buffer | undefined;
  let adminBytes: Buffer | undefined;
  try {
    await requirePrivateFile(resolvedDirectory, "directory", 0o700);
    manifestBytes = await readPrivateFile(join(resolvedDirectory, "broker-daemon.json"), 65_536);
    clientBytes = await readPrivateFile(join(resolvedDirectory, "client.token"), 64);
    adminBytes = await readPrivateFile(join(resolvedDirectory, "admin.token"), 64);
    const value: unknown = JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(manifestBytes));
    if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error();
    const record = value as Record<string, unknown>;
    const manifestKeys = ["version", "installationId", "instanceId", "dockerExecutable", "images", "trustedNonPublicMappings"];
    if (Object.keys(record).length !== manifestKeys.length || manifestKeys.some((key) => !(key in record)) || record.version !== 1 ||
      typeof record.installationId !== "string" || !/^[A-Za-z0-9_-]{1,96}$/.test(record.installationId) ||
      typeof record.instanceId !== "string" || !/^[A-Za-z0-9_-]{1,96}$/.test(record.instanceId)) throw new Error();
    const clientToken = clientBytes.toString("ascii");
    const adminToken = adminBytes.toString("ascii");
    if (!/^[a-f0-9]{64}$/.test(clientToken) || !/^[a-f0-9]{64}$/.test(adminToken) || clientToken === adminToken) throw new Error();
    return {
      directory: resolvedDirectory,
      principal: { installationId: record.installationId, instanceId: record.instanceId },
      clientToken,
      adminToken,
    };
  } catch {
    throw new Error("Isolated cURL broker configuration is missing or invalid. Set NULLTRACE_EXECUTION_BROKER_DIR to a provisioned private directory.");
  } finally {
    manifestBytes?.fill(0);
    clientBytes?.fill(0);
    adminBytes?.fill(0);
  }
}

async function requirePrivateFile(path: string, kind: "directory" | "file", mode: number): Promise<void> {
  const stat = await lstat(path);
  if (stat.isSymbolicLink() || (kind === "directory" ? !stat.isDirectory() : !stat.isFile() || stat.nlink !== 1) ||
    (stat.mode & 0o777) !== mode || stat.uid !== process.getuid?.()) {
    throw new Error("Isolated cURL broker client files must be private and owner-controlled.");
  }
}

async function readPrivateFile(path: string, maximumBytes: number): Promise<Buffer> {
  const pathStat = await lstat(path);
  if (!pathStat.isFile() || pathStat.isSymbolicLink() || pathStat.nlink !== 1 || pathStat.uid !== process.getuid?.() ||
    (pathStat.mode & 0o777) !== 0o600 || pathStat.size > maximumBytes) {
    throw new Error("Isolated cURL broker client files must be private and owner-controlled.");
  }
  const handle = await open(path, constants.O_RDONLY | constants.O_NOFOLLOW);
  try {
    const stat = await handle.stat();
    if (!stat.isFile() || stat.nlink !== 1 || stat.uid !== process.getuid?.() ||
      stat.dev !== pathStat.dev || stat.ino !== pathStat.ino || (stat.mode & 0o777) !== 0o600 || stat.size > maximumBytes) throw new Error();
    const buffer = Buffer.alloc(maximumBytes + 1);
    try {
      const { bytesRead } = await handle.read(buffer, 0, buffer.byteLength, 0);
      if (bytesRead > maximumBytes) throw new Error();
      return Buffer.from(buffer.subarray(0, bytesRead));
    } finally {
      buffer.fill(0);
    }
  } catch {
    throw new Error("Isolated cURL broker client files must be private and owner-controlled.");
  } finally {
    await handle.close();
  }
}
