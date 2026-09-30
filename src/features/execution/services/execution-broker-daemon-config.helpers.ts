import { constants } from "node:fs";
import { lstat, open } from "node:fs/promises";
import { isIP } from "node:net";
import { isAbsolute, join } from "node:path";
import { ExecutionBrokerDaemonStartup } from "../types/execution-broker-daemon.types";
import { ExecutionPlan, ExecutionProfile } from "../types/execution-plan.types";
import { requireExecutionId, requireExecutionRecord } from "./execution-validation.helpers";

const publicCurlProfile: ExecutionProfile = {
  id: "public-curl-v1",
  tool: "curl",
  mode: "public",
  executableIds: ["curl"],
  inputs: [],
  maximumLimits: {
    timeoutMs: 30_000,
    memoryBytes: 512 * 1024 * 1024,
    cpuMilliCores: 1_000,
    processCount: 128,
    scratchBytes: 64 * 1024 * 1024,
    fileBytes: 16 * 1024 * 1024,
    outputBytes: 1024 * 1024,
  },
};

const publicCurlWorkerProfile: ExecutionProfile = {
  id: "public-curl-worker-v1",
  tool: "curl",
  mode: "public-worker",
  executableIds: ["bun"],
  inputs: [{ id: "curl-config", kind: "data", maximumBytes: 2 * 1024 * 1024 }],
  minimumOutputBytes: 384 * 1024,
  maximumLimits: {
    timeoutMs: 30_000,
    memoryBytes: 512 * 1024 * 1024,
    cpuMilliCores: 1_000,
    processCount: 128,
    scratchBytes: 64 * 1024 * 1024,
    fileBytes: 16 * 1024 * 1024,
    outputBytes: 1024 * 1024,
  },
};

export async function loadExecutionBrokerDaemonConfiguration(directory: string): Promise<ExecutionBrokerDaemonStartup> {
  if (!isAbsolute(directory)) throw new Error("Broker directory must be absolute.");
  await requirePrivatePath(directory, "directory", 0o700);
  const configPath = join(directory, "broker-daemon.json");
  const keyPath = join(directory, "broker.key");
  const tokenPath = join(directory, "client.token");
  const adminTokenPath = join(directory, "admin.token");
  let configBytes: Buffer | undefined;
  let key: Buffer | undefined;
  let tokenBytes: Buffer | undefined;
  let adminTokenBytes: Buffer | undefined;
  try {
    configBytes = await readPrivateFile(configPath, 65_536);
    key = await readPrivateFile(keyPath, 32);
    tokenBytes = await readPrivateFile(tokenPath, 64);
    adminTokenBytes = await readPrivateFile(adminTokenPath, 64);
    if (key.byteLength !== 32) throw new Error("Invalid broker key length.");
    const token = tokenBytes.toString("ascii");
    if (!/^[a-f0-9]{64}$/.test(token)) throw new Error("Invalid broker client token.");
    const adminToken = adminTokenBytes.toString("ascii");
    if (!/^[a-f0-9]{64}$/.test(adminToken) || adminToken === token) throw new Error("Invalid broker administrator token.");
    const value: unknown = JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(configBytes));
    const config = requireExecutionRecord(value, [
      "version", "installationId", "instanceId", "dockerExecutable", "images",
      "trustedNonPublicMappings",
    ]);
    if (config.version !== 1) throw new Error("Unsupported broker configuration.");
    const installationId = requireExecutionId(config.installationId);
    const instanceId = requireExecutionId(config.instanceId);
    if (typeof config.dockerExecutable !== "string" || !isAbsolute(config.dockerExecutable) ||
      config.dockerExecutable.includes("\0")) throw new Error("Invalid Docker executable path.");
    const images = requireExecutionRecord(config.images, ["worker", "proxy", "initializer"]);
    for (const image of Object.values(images)) {
      if (typeof image !== "string" || !/^sha256:[a-f0-9]{64}$/.test(image)) throw new Error("Invalid isolation image ID.");
    }
    const mappings = parseTrustedMappings(config.trustedNonPublicMappings);
    const principal = { installationId, instanceId };
    return {
      dockerExecutable: config.dockerExecutable,
      hostOptions: {
        directory,
        adminToken,
        installationId,
        hmacKey: Uint8Array.from(key),
        identities: [{ token, principal }],
        profiles: [publicCurlProfile, publicCurlWorkerProfile],
        publicDataEventProfileIds: [publicCurlWorkerProfile.id],
        trustedNonPublicMappings: mappings,
        useAuthorizationLedger: true,
        authorizationPlanValidator: (plan) => isSupportedPublicCurlPlan(plan) || isSupportedPublicCurlWorkerPlan(plan),
        readAuthorization: () => null,
        images: {
          worker: images.worker as string,
          proxy: images.proxy as string,
          initializer: images.initializer as string,
        },
      },
    };
  } finally {
    configBytes?.fill(0);
    key?.fill(0);
    tokenBytes?.fill(0);
    adminTokenBytes?.fill(0);
  }
}

function isSupportedPublicCurlPlan(plan: ExecutionPlan): boolean {
  try {
    if (plan.profileId !== publicCurlProfile.id || plan.tool !== "curl" || plan.mode !== "public" ||
      plan.invocation.executableId !== "curl" || plan.inputs.length !== 0) return false;
    const argv = plan.invocation.argv;
    const prefix = ["--silent", "--show-error", "--fail"];
    if (prefix.some((value, index) => argv[index] !== value)) return false;
    const offset = argv[3] === "--location" ? 1 : 0;
    if (argv.length !== 6 + offset || argv[3 + offset] !== "--max-time" ||
      !/^(?:[1-9]|[12][0-9]|30)$/.test(argv[4 + offset] ?? "")) return false;
    const target = new URL(argv[5 + offset]!);
    return plan.origins.length === 1 && plan.origins[0] === target.origin &&
      !target.username && !target.password && !target.search && !target.hash;
  } catch { return false; }
}

function isSupportedPublicCurlWorkerPlan(plan: ExecutionPlan): boolean {
  try {
    if (plan.profileId !== publicCurlWorkerProfile.id || plan.tool !== "curl" ||
      plan.mode !== "public-worker" || plan.invocation.executableId !== "bun" ||
      plan.invocation.argv.length !== 2 || plan.invocation.argv[0] !== "run" ||
      plan.invocation.argv[1] !== "/opt/nulltrace/workers/curl-worker.ts" ||
      plan.origins.length !== 1 || plan.inputs.length !== 1 ||
      plan.inputs[0]?.id !== "curl-config" || plan.inputs[0]?.kind !== "data" ||
      plan.inputs[0]?.maximumBytes !== 2 * 1024 * 1024 ||
      plan.limits.outputBytes < (publicCurlWorkerProfile.minimumOutputBytes ?? Number.MAX_SAFE_INTEGER)) return false;
    const origin = new URL(plan.origins[0]!);
    return origin.origin === plan.origins[0] &&
      (origin.protocol === "http:" || origin.protocol === "https:") &&
      !origin.username && !origin.password && !origin.search && !origin.hash && origin.pathname === "/";
  } catch { return false; }
}

async function requirePrivatePath(path: string, kind: "directory" | "file", mode: number): Promise<void> {
  const stat = await lstat(path);
  if (stat.isSymbolicLink() || (kind === "directory" ? !stat.isDirectory() : !stat.isFile() || stat.nlink !== 1) ||
    (stat.mode & 0o777) !== mode || stat.uid !== process.getuid?.()) {
    throw new Error("Broker configuration path is not private and owner-controlled.");
  }
}

async function readPrivateFile(path: string, maximumBytes: number): Promise<Buffer> {
  const handle = await open(path, constants.O_RDONLY | constants.O_NOFOLLOW);
  try {
    const stat = await handle.stat();
    if (!stat.isFile() || stat.nlink !== 1 || (stat.mode & 0o777) !== 0o600 ||
      stat.uid !== process.getuid?.() || stat.size > maximumBytes) {
      throw new Error("Broker configuration path is not private and owner-controlled.");
    }
    const bytes = await handle.readFile();
    if (bytes.byteLength > maximumBytes) {
      bytes.fill(0);
      throw new Error("Broker configuration file exceeded its limit.");
    }
    return bytes;
  } finally {
    await handle.close();
  }
}

function parseTrustedMappings(value: unknown): Record<string, string[]> {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error("Invalid trusted target mappings.");
  const entries = Object.entries(value);
  if (entries.length > 32) throw new Error("Too many trusted target mappings.");
  const mappings: Record<string, string[]> = {};
  for (const [host, addresses] of entries) {
    if (!/^[a-z0-9][a-z0-9.-]{0,252}$/.test(host) || !Array.isArray(addresses) || addresses.length < 1 || addresses.length > 16 ||
      addresses.some((address) => typeof address !== "string" || isIP(address) === 0)) {
      throw new Error("Invalid trusted target mapping.");
    }
    mappings[host] = [...addresses];
  }
  return mappings;
}
