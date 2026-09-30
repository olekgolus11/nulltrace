import { randomUUID } from "node:crypto";
import { CurlValidatedCommand } from "../types/curl.types";
import { CurlWorkerBodyOperation, CurlWorkerInput } from "../types/curl-broker.types";
import { ExecutionBrokerClientConfiguration } from "../../../execution/types/execution-broker-client.types";
import { ExecutionPlan } from "../../../execution/types/execution-plan.types";
import { curlMaximumRedirectCount, curlMaximumResponseBytes, curlRequestTimeoutSeconds } from "../config/curl.config";

export function buildCurlWorkerInput(command: CurlValidatedCommand, sessionTargetUrl: string): CurlWorkerInput {
  let targetCount = 0;
  let target = "";
  const headers: string[] = [];
  const bodyOperations: CurlWorkerBodyOperation[] = [];
  for (let index = 1; index < command.tokens.length; index += 1) {
    const token = command.tokens[index]!;
    const equals = token.indexOf("=");
    const option = equals > 0 ? token.slice(0, equals) : token;
    const inlineValue = equals > 0 ? token.slice(equals + 1) : null;
    if (option === "-X" || option === "--request") { if (inlineValue === null) index += 1; continue; }
    if (option === "--url") {
      targetCount += 1;
      if (inlineValue === null) target = command.tokens[++index] ?? "";
      else target = inlineValue;
      continue;
    }
    if (option === "-H" || option === "--header") {
      headers.push(inlineValue ?? command.tokens[++index] ?? "");
      continue;
    }
    if (["-d", "--data", "--data-raw", "--data-binary"].includes(option)) {
      const value = inlineValue ?? command.tokens[++index] ?? "";
      bodyOperations.push({ kind: option === "-d" ? "data" : option.replace(/^--/, "") as CurlWorkerBodyOperation["kind"], value });
      continue;
    }
    if (!option.startsWith("-")) { targetCount += 1; target = token; }
  }
  if (targetCount !== 1 || target !== command.targetUrl) throw new Error("cURL command must contain exactly one target URL.");
  return {
    version: 1,
    targetUrl: command.targetUrl,
    exactOrigin: new URL(sessionTargetUrl).origin,
    method: command.method,
    headers,
    bodyOperations,
    maximumRedirectCount: curlMaximumRedirectCount,
    maximumResponseBytes: curlMaximumResponseBytes,
    timeoutSeconds: curlRequestTimeoutSeconds,
  };
}

export function createCurlWorkerPlan(
  targetUrl: string,
  configuration: ExecutionBrokerClientConfiguration,
): ExecutionPlan {
  return {
    version: 1,
    executionId: randomUUID(),
    authorizationId: randomUUID(),
    profileId: "public-curl-worker-v1",
    tool: "curl",
    mode: "public-worker",
    invocation: { executableId: "bun", argv: ["run", "/opt/nulltrace/workers/curl-worker.ts"] },
    origins: [new URL(targetUrl).origin],
    inputs: [{ id: "curl-config", kind: "data", maximumBytes: 2 * 1024 * 1024 }],
    limits: {
      timeoutMs: 30_000,
      memoryBytes: 512 * 1024 * 1024,
      cpuMilliCores: 1_000,
      processCount: 128,
      scratchBytes: 64 * 1024 * 1024,
      fileBytes: 16 * 1024 * 1024,
      outputBytes: 1024 * 1024,
    },
  };
}
