import { ExecutionInputSlot, ExecutionPlan, ExecutionProfile } from "./execution-plan.types";

export interface ExecutionPrincipal {
  installationId: string;
  instanceId: string;
}

export interface ExecutionAuthorization {
  principal: ExecutionPrincipal;
  plan: ExecutionPlan;
  expiresAt: number;
}

export type ExecutionAdmissionStatus = "prepared" | "start_committed" | "started" | "interrupted" | "closed";

export interface ExecutionReceipt {
  executionId: string;
  status: ExecutionAdmissionStatus;
  cleanup: "pending" | "confirmed";
}

export interface ExecutionRuntimeAdapter {
  putInput(plan: ExecutionPlan, slot: ExecutionInputSlot, bytes: Uint8Array): Promise<void>;
  start(plan: ExecutionPlan): Promise<void>;
}

export interface ExecutionBrokerOptions {
  profiles: ExecutionProfile[];
  readAuthorization: (principal: ExecutionPrincipal, authorizationId: string) => ExecutionAuthorization | null;
  runtime?: ExecutionRuntimeAdapter;
  now?: () => number;
}

export interface ExecutionBrokerIdentity {
  token: string;
  principal: ExecutionPrincipal;
}

export interface StoredExecutionReceipt extends ExecutionReceipt {
  owner: string;
  fingerprint: string;
  sealedInputs: Record<string, string>;
}

export type ExecutionBrokerErrorCode = "INVALID_REQUEST" | "UNAUTHORIZED" | "NOT_FOUND" | "CONFLICT" | "UNAVAILABLE" | "CAPACITY";
