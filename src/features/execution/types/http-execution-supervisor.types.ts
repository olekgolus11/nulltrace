import { ExecutionLimits, ExecutionPlan } from "./execution-plan.types";
import { ExecutionCredentialBinding } from "./execution-broker.types";
import { HttpExecutionNetworkInput, HttpExecutionNetworkPolicy, HttpExecutionNetworkRunResult } from "./http-execution-network.types";
import { ExecutionOutputStream } from "./execution-event.types";

export type HttpExecutionStopReason = "cancelled" | "lease_expired" | "deadline";
export type HttpExecutionSupervisedStatus = "running" | "finished" | "interrupted";

export interface HttpExecutionSupervisedRun {
  executionId: string;
  status: HttpExecutionSupervisedStatus;
  stopReason: HttpExecutionStopReason | null;
  cleanup: "pending" | "confirmed";
  exitCode: number | null;
}

export interface HttpExecutionSupervisorOptions {
  leaseMs: number;
  cleanupWaitMs?: number;
  inputRetentionMs?: number;
  maximumRetainedRuns?: number;
  secretOutputSanitizer?: HttpExecutionSecretOutputSanitizer;
  onSettled: (run: HttpExecutionSupervisedRun) => Promise<void> | void;
}

export interface HttpExecutionSecretOutputSanitizer {
  /** A throwing create must release any partial state before it throws. */
  create(plan: ExecutionPlan, inputs: readonly HttpExecutionNetworkInput[], credentialBinding?: ExecutionCredentialBinding | null): HttpExecutionSecretOutputSession | null;
}

export interface HttpExecutionSecretOutputSession {
  /** Copies bounded bytes before returning; false permanently disables this session. */
  capture(stream: "stdout" | "stderr", chunk: Uint8Array): boolean;
  sanitize(): Readonly<Record<"stdout" | "stderr", string>> | null;
  /** Idempotently wipes all captured bytes and releases secret-bearing closures. */
  destroy(): void;
}

export interface HttpExecutionSupervisedResolver {
  resolve(executionId: string, origins: readonly string[]): Promise<HttpExecutionNetworkPolicy>;
}

export interface HttpExecutionSupervisedNetwork {
  run(
    policy: HttpExecutionNetworkPolicy,
    limits: ExecutionLimits,
    executable: string,
    argv: string[],
    signal?: AbortSignal,
    onOutput?: (stream: ExecutionOutputStream, chunk: Uint8Array) => void,
    inputs?: HttpExecutionNetworkInput[],
  ): Promise<HttpExecutionNetworkRunResult>;
}
