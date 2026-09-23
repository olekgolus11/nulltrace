import { ExecutionLimits } from "./execution-plan.types";
import { HttpExecutionNetworkPolicy, HttpExecutionNetworkRunResult } from "./http-execution-network.types";

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
  maximumRetainedRuns?: number;
  onSettled: (run: HttpExecutionSupervisedRun) => Promise<void> | void;
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
  ): Promise<HttpExecutionNetworkRunResult>;
}
