import { ExecutionBrokerErrorCode } from "../types/execution-broker.types";

export class ExecutionBrokerError extends Error {
  constructor(readonly code: ExecutionBrokerErrorCode) {
    super(code);
  }
}
