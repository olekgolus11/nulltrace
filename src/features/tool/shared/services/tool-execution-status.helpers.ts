import { ExecutionStatus } from "../types/tool-screen.types";

export function isToolExecutionBusy(status: ExecutionStatus): boolean {
  return status === "running" || status === "cancelling";
}

export function getToolExecutionStatusLabel(status: ExecutionStatus, exitCode: number | null): string {
  if (status === "cancelling") return "cancelling; waiting for cleanup";
  if (exitCode === null) return status;
  return `${status} (${exitCode})`;
}
