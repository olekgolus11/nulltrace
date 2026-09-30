import { ExecutionInputSlot, ExecutionPlan, ExecutionProfile } from "./execution-plan.types";
import { ExecutionEventPage } from "./execution-event.types";

export interface ExecutionPrincipal {
  installationId: string;
  instanceId: string;
}

export interface ExecutionAuthorization {
  principal: ExecutionPrincipal;
  plan: ExecutionPlan;
  expiresAt: number;
}

export interface ExecutionCredentialBinding {
  scopeId: string;
  generation: number;
}

export interface ExecutionCredentialAuthority {
  resolveBinding(
    principal: ExecutionPrincipal,
    authorizationId: string,
    plan: ExecutionPlan,
  ): ExecutionCredentialBinding | null;
  isCurrent(principal: ExecutionPrincipal, binding: ExecutionCredentialBinding): boolean;
}

export type ExecutionAdmissionStatus = "prepared" | "start_committed" | "started" | "interrupted" | "closed";

export interface ExecutionReceipt {
  executionId: string;
  status: ExecutionAdmissionStatus;
  cleanup: "pending" | "confirmed";
}

export interface ExecutionRuntimeAdapter {
  putInput(plan: ExecutionPlan, slot: ExecutionInputSlot, bytes: Uint8Array, credentialBinding?: ExecutionCredentialBinding | null): Promise<void>;
  discardInputs?(executionId: string): void;
  start(plan: ExecutionPlan, credentialBinding?: ExecutionCredentialBinding | null): Promise<void>;
  readEvents?(executionId: string, afterSequence: number, maximumEvents?: number): ExecutionEventPage;
  cancel?(executionId: string): ExecutionControlReceipt;
  waitForCleanup?(executionId: string): Promise<ExecutionControlReceipt>;
  getControl?(executionId: string): ExecutionControlReceipt;
  renewOwnership?(executionId: string): ExecutionControlReceipt;
}

export interface ExecutionControlReceipt {
  executionId: string;
  status: "running" | "finished" | "interrupted";
  stopReason: "cancelled" | "lease_expired" | "deadline" | null;
  cleanup: "pending" | "confirmed";
  exitCode: number | null;
}

export interface ExecutionBrokerOptions {
  profiles: ExecutionProfile[];
  publicDataEventProfileIds?: string[];
  readAuthorization: (principal: ExecutionPrincipal, authorizationId: string, requestedPlan?: ExecutionPlan) => ExecutionAuthorization | null;
  credentialAuthority?: ExecutionCredentialAuthority;
  authCheckOutputProfileId?: string;
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
  credentialBinding: ExecutionCredentialBinding | null;
  credentialRevoked: boolean;
}

export type ExecutionOutcomeCause = "normal" | "nonzero_exit" | "cancelled" | "lease_expired" | "deadline" | "infrastructure";

export interface ExecutionOutcome {
  executionId: string;
  cause: ExecutionOutcomeCause;
  exitCode: number | null;
  cleanup: "pending" | "confirmed";
}

export type ExecutionBrokerErrorCode = "INVALID_REQUEST" | "UNAUTHORIZED" | "NOT_FOUND" | "CONFLICT" | "UNAVAILABLE" | "CAPACITY";
