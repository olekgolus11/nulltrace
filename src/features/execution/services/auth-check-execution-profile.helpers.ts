import type { AuthCheckWorkerResult } from "../../../../infrastructure/isolation/auth-check-worker.types";
import { parseAuthCheckWorkerResult } from "../../../../infrastructure/isolation/auth-check-worker-protocol.helpers";
import { ExecutionPlan, ExecutionProfile } from "../types/execution-plan.types";
import { AuthCheckExecutionPlanInput } from "../types/auth-check-execution-profile.types";

export const authCheckExecutionProfile: ExecutionProfile = {
  id: "auth-check-worker-v1",
  tool: "auth-check",
  mode: "authenticated-worker",
  executableIds: ["bun"],
  inputs: [{ id: "auth-check-config", kind: "secret", maximumBytes: 128 * 1024 }],
  maximumLimits: {
    timeoutMs: 60_000,
    memoryBytes: 256 * 1024 * 1024,
    cpuMilliCores: 1_000,
    processCount: 32,
    scratchBytes: 2 * 1024 * 1024,
    fileBytes: 128 * 1024,
    outputBytes: 4_096,
  },
};

export function createAuthCheckExecutionPlan(input: AuthCheckExecutionPlanInput): ExecutionPlan {
  return {
    version: 1,
    executionId: input.executionId,
    authorizationId: input.authorizationId,
    profileId: authCheckExecutionProfile.id,
    tool: authCheckExecutionProfile.tool,
    mode: authCheckExecutionProfile.mode,
    invocation: { executableId: "bun", argv: ["run", "/opt/nulltrace/workers/auth-check-worker.js"] },
    origins: [input.origin],
    inputs: [{ ...authCheckExecutionProfile.inputs[0]! }],
    limits: { ...authCheckExecutionProfile.maximumLimits },
  };
}

export function isSupportedAuthCheckExecutionPlan(plan: ExecutionPlan): boolean {
  if (plan.profileId !== authCheckExecutionProfile.id || plan.tool !== authCheckExecutionProfile.tool ||
      plan.mode !== authCheckExecutionProfile.mode || plan.invocation.executableId !== "bun" ||
      plan.invocation.argv.length !== 2 || plan.invocation.argv[0] !== "run" ||
      plan.invocation.argv[1] !== "/opt/nulltrace/workers/auth-check-worker.js" ||
      plan.origins.length !== 1 || plan.inputs.length !== 1 || plan.inputs[0]?.id !== "auth-check-config" ||
      plan.inputs[0]?.kind !== "secret" || plan.inputs[0]?.maximumBytes !== 128 * 1024 ||
      plan.limits.timeoutMs > 60_000 || plan.limits.outputBytes > 4_096 || plan.limits.fileBytes > 128 * 1024 ||
      plan.limits.scratchBytes > 2 * 1024 * 1024 || plan.limits.processCount > 32 ||
      plan.limits.memoryBytes > 256 * 1024 * 1024 || plan.limits.cpuMilliCores > 1_000 ||
      !Object.values(plan.limits).every((limit) => Number.isSafeInteger(limit) && limit > 0) ||
      plan.limits.fileBytes > plan.limits.scratchBytes) return false;
  try {
    const origin = new URL(plan.origins[0]!);
    return origin.origin === plan.origins[0] && (origin.protocol === "http:" || origin.protocol === "https:") &&
      !origin.username && !origin.password && !origin.search && !origin.hash && origin.pathname === "/" &&
      plan.limits.timeoutMs >= 1_000 && plan.limits.outputBytes >= 1_024;
  } catch { return false; }
}

export function parseAuthCheckExecutionResultFrame(output: string, maximumBytes = 4_096): AuthCheckWorkerResult {
  if (Buffer.byteLength(output) > maximumBytes || !output.endsWith("\n") || output.slice(0, -1).includes("\n") ||
      output.includes("\r")) throw new Error("Invalid Auth Check result frame.");
  const value: unknown = JSON.parse(output.slice(0, -1));
  return parseAuthCheckWorkerResult(value);
}
