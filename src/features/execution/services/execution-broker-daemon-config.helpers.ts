import { constants } from "node:fs";
import { lstat, open } from "node:fs/promises";
import { isIP } from "node:net";
import { isAbsolute, join } from "node:path";
import { ExecutionBrokerDaemonStartup } from "../types/execution-broker-daemon.types";
import { ExecutionPlan, ExecutionProfile } from "../types/execution-plan.types";
import { parseExecutionPlan } from "./execution-plan.helpers";
import { requireExecutionId, requireExecutionInteger, requireExecutionRecord } from "./execution-validation.helpers";

const privateDirectoryMode = 0o700;
const privateFileMode = 0o600;
const allPermissionBits = 0o777;
const maxConfigFileBytes = 65_536;
const brokerKeyBytes = 32;
const clientTokenBytes = 64;
const maxTrustedMappings = 32;
const maxAddressesPerHost = 16;
const maxCurlTimeoutSeconds = 30;

const publicCurlProfile: ExecutionProfile = {
  id: "public-curl-v1",
  tool: "curl",
  mode: "public",
  executableIds: ["curl"],
  inputs: [],
  maximumLimits: {
    timeoutMs: maxCurlTimeoutSeconds * 1000,
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
  await requirePrivatePath(directory, "directory", privateDirectoryMode);
  const configPath = join(directory, "broker-daemon.json");
  const keyPath = join(directory, "broker.key");
  const tokenPath = join(directory, "client.token");
  let configBytes: Buffer | undefined;
  let key: Buffer | undefined;
  let tokenBytes: Buffer | undefined;
  try {
    configBytes = await readPrivateFile(configPath, maxConfigFileBytes);
    key = await readPrivateFile(keyPath, brokerKeyBytes);
    tokenBytes = await readPrivateFile(tokenPath, clientTokenBytes);
    if (key.byteLength !== brokerKeyBytes) throw new Error("Invalid broker key length.");
    const token = tokenBytes.toString("ascii");
    const tokenPattern = new RegExp(`^[a-f0-9]{${clientTokenBytes}}$`);
    if (!tokenPattern.test(token)) throw new Error("Invalid broker client token.");
    const value: unknown = JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(configBytes));
    const config = requireExecutionRecord(value, [
      "version", "installationId", "instanceId", "dockerExecutable", "images",
      "trustedNonPublicMappings", "approvedPlan", "expiresAt",
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
    const plan = parseExecutionPlan(config.approvedPlan, [publicCurlProfile]);
    assertPublicCurlInvocation(plan);
    const expiresAt = requireExecutionInteger(config.expiresAt, Number.MAX_SAFE_INTEGER);
    if (expiresAt <= Date.now()) throw new Error("Broker approval expired.");
    const principal = { installationId, instanceId };
    const approvedPlan: ExecutionPlan = structuredClone(plan);
    return {
      dockerExecutable: config.dockerExecutable,
      hostOptions: {
        directory,
        installationId,
        hmacKey: Uint8Array.from(key),
        identities: [{ token, principal }],
        profiles: [publicCurlProfile],
        trustedNonPublicMappings: mappings,
        readAuthorization(caller, authorizationId) {
          return caller.installationId === installationId && caller.instanceId === instanceId &&
            authorizationId === approvedPlan.authorizationId
            ? { principal, plan: structuredClone(approvedPlan), expiresAt }
            : null;
        },
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
  }
}

async function requirePrivatePath(path: string, kind: "directory" | "file", mode: number): Promise<void> {
  const stat = await lstat(path);
  if (stat.isSymbolicLink() || (kind === "directory" ? !stat.isDirectory() : !stat.isFile() || stat.nlink !== 1) ||
    (stat.mode & allPermissionBits) !== mode || stat.uid !== process.getuid?.()) {
    throw new Error("Broker configuration path is not private and owner-controlled.");
  }
}

async function readPrivateFile(path: string, maximumBytes: number): Promise<Buffer> {
  const handle = await open(path, constants.O_RDONLY | constants.O_NOFOLLOW);
  try {
    const stat = await handle.stat();
    if (!stat.isFile() || stat.nlink !== 1 || (stat.mode & allPermissionBits) !== privateFileMode ||
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

function assertPublicCurlInvocation(plan: ExecutionPlan): void {
  const argv = plan.invocation.argv;
  const prefix = ["--silent", "--show-error", "--fail"];
  if (prefix.some((value, index) => argv[index] !== value)) throw new Error("Unsupported public cURL invocation.");
  const offset = argv[3] === "--location" ? 1 : 0;
  const timeoutPattern = new RegExp(`^(?:[1-9]|[12][0-9]|${maxCurlTimeoutSeconds})$`);
  if (argv.length !== 6 + offset || argv[3 + offset] !== "--max-time" ||
    !timeoutPattern.test(argv[4 + offset] ?? "")) {
    throw new Error("Unsupported public cURL invocation.");
  }
  const target = new URL(argv[5 + offset]!);
  if (!plan.origins.includes(target.origin) || target.username || target.password || target.search || target.hash) {
    throw new Error("Public cURL target is outside the approved origin or contains private URL fields.");
  }
}

function parseTrustedMappings(value: unknown): Record<string, string[]> {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error("Invalid trusted target mappings.");
  const entries = Object.entries(value);
  if (entries.length > maxTrustedMappings) throw new Error("Too many trusted target mappings.");
  const mappings: Record<string, string[]> = {};
  for (const [host, addresses] of entries) {
    if (!/^[a-z0-9][a-z0-9.-]{0,252}$/.test(host) || !Array.isArray(addresses) || addresses.length < 1 || addresses.length > maxAddressesPerHost ||
      addresses.some((address) => typeof address !== "string" || isIP(address) === 0)) {
      throw new Error("Invalid trusted target mapping.");
    }
    mappings[host] = [...addresses];
  }
  return mappings;
}
