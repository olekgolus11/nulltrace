import { ExecutionInputSlot, ExecutionLimits, ExecutionPlan, ExecutionProfile } from "../types/execution-plan.types";
import {
  requireExecutionArray,
  requireExecutionId,
  requireExecutionInteger,
  requireExecutionRecord,
} from "./execution-validation.helpers";

const MAXIMUM_INPUT_SLOTS = 16;
const MAXIMUM_ARGV_LENGTH = 256;
const MAXIMUM_ARGV_BYTES = 32_768;
const MAXIMUM_ORIGIN_COUNT = 32;
const MAXIMUM_ORIGIN_LENGTH = 2_048;
const MAXIMUM_INPUT_BYTES = 8 * 1024 * 1024;

const limitKeys = ["timeoutMs", "memoryBytes", "cpuMilliCores", "processCount", "scratchBytes", "fileBytes", "outputBytes"];

export function parseExecutionPlan(value: unknown, profiles: readonly ExecutionProfile[]): ExecutionPlan {
  const record = requireExecutionRecord(value, [
    "version", "executionId", "authorizationId", "profileId", "tool", "mode", "invocation", "origins", "inputs", "limits",
  ]);
  if (record.version !== 1) throw new Error("Unsupported execution version.");
  const profile = profiles.find((candidate) => candidate.id === record.profileId);
  if (!profile || record.tool !== profile.tool || record.mode !== profile.mode) {
    throw new Error("Unavailable execution profile.");
  }
  const invocation = requireExecutionRecord(record.invocation, ["executableId", "argv"]);
  const executableId = requireExecutionId(invocation.executableId);
  if (!profile.executableIds.includes(executableId)) throw new Error("Unavailable executable.");
  let argvBytes = 0;
  const argv = requireExecutionArray(invocation.argv, MAXIMUM_ARGV_LENGTH).map((argument) => {
    if (typeof argument !== "string" || argument.includes("\0")) throw new Error("Invalid execution argument.");
    argvBytes += Buffer.byteLength(argument);
    if (argvBytes > MAXIMUM_ARGV_BYTES) throw new Error("Execution arguments exceed the limit.");
    return argument;
  });
  const origins = requireExecutionArray(record.origins, MAXIMUM_ORIGIN_COUNT).map((value) => {
    if (typeof value !== "string" || value.length > MAXIMUM_ORIGIN_LENGTH) throw new Error("Invalid execution origin.");
    const url = new URL(value);
    if (!["http:", "https:"].includes(url.protocol) || url.origin !== value || url.username || url.password) {
      throw new Error("Execution origins must be normalized HTTP origins.");
    }
    return value;
  });
  if (!origins.length || new Set(origins).size !== origins.length) throw new Error("Invalid execution origins.");
  const inputs = requireExecutionArray(record.inputs, MAXIMUM_INPUT_SLOTS).map((value) => parseInput(value, profile));
  if (new Set(inputs.map((input) => input.id)).size !== inputs.length || inputs.length !== profile.inputs.length) {
    throw new Error("Execution input slots do not match the profile.");
  }
  return {
    version: 1,
    executionId: requireExecutionId(record.executionId),
    authorizationId: requireExecutionId(record.authorizationId),
    profileId: profile.id,
    tool: profile.tool,
    mode: profile.mode,
    invocation: { executableId, argv },
    origins,
    inputs,
    limits: parseLimits(record.limits, profile.maximumLimits),
  };
}

function parseInput(value: unknown, profile: ExecutionProfile): ExecutionInputSlot {
  const input = requireExecutionRecord(value, ["id", "kind", "maximumBytes"]);
  const id = requireExecutionId(input.id);
  const allowed = profile.inputs.find((slot) => slot.id === id);
  if (!allowed || input.kind !== allowed.kind) throw new Error("Invalid execution input slot.");
  return { id, kind: allowed.kind, maximumBytes: requireExecutionInteger(input.maximumBytes, Math.min(allowed.maximumBytes, MAXIMUM_INPUT_BYTES)) };
}

function parseLimits(value: unknown, maximum: ExecutionLimits): ExecutionLimits {
  const record = requireExecutionRecord(value, limitKeys);
  const limits = {
    timeoutMs: requireExecutionInteger(record.timeoutMs, maximum.timeoutMs),
    memoryBytes: requireExecutionInteger(record.memoryBytes, maximum.memoryBytes),
    cpuMilliCores: requireExecutionInteger(record.cpuMilliCores, maximum.cpuMilliCores),
    processCount: requireExecutionInteger(record.processCount, maximum.processCount),
    scratchBytes: requireExecutionInteger(record.scratchBytes, maximum.scratchBytes),
    fileBytes: requireExecutionInteger(record.fileBytes, maximum.fileBytes),
    outputBytes: requireExecutionInteger(record.outputBytes, maximum.outputBytes),
  };
  if (limits.fileBytes > limits.scratchBytes) throw new Error("File limit exceeds scratch capacity.");
  return limits;
}
