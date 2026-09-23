import { ExecutionOutcome } from "../types/execution-broker.types";
import { HttpExecutionSupervisedRun } from "../types/http-execution-supervisor.types";

export function toExecutionOutcome(run: HttpExecutionSupervisedRun): ExecutionOutcome {
  if (run.status === "running") throw new Error("Cannot persist an active execution outcome.");
  const cause = run.stopReason ?? (run.exitCode === 0 ? "normal" : run.exitCode === null ? "infrastructure" : "nonzero_exit");
  return {
    executionId: run.executionId,
    cause,
    exitCode: run.exitCode,
    cleanup: run.cleanup,
  };
}
