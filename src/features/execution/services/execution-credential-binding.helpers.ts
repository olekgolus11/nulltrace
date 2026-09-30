import { ExecutionCredentialBinding } from "../types/execution-broker.types";

export function sameExecutionCredentialBinding(
  left: ExecutionCredentialBinding | null,
  right: ExecutionCredentialBinding | null,
): boolean {
  return left?.scopeId === right?.scopeId && left?.generation === right?.generation;
}
