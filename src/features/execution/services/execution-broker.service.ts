import {
  ExecutionBrokerOptions,
  ExecutionPrincipal,
  ExecutionReceipt,
  StoredExecutionReceipt,
} from "../types/execution-broker.types";
import { ExecutionPlan } from "../types/execution-plan.types";
import { ExecutionEventPage } from "../types/execution-event.types";
import { ExecutionBrokerError } from "./execution-broker.error";
import { parseExecutionPlan } from "./execution-plan.helpers";
import { ExecutionReceiptRepository } from "./execution-receipt.repository";
import { requireExecutionId } from "./execution-validation.helpers";

export class ExecutionBrokerService {
  private readonly plans = new Map<string, ExecutionPlan>();
  private readonly writing = new Set<string>();
  private readonly options: ExecutionBrokerOptions;
  private readonly now: () => number;

  constructor(private readonly receipts: ExecutionReceiptRepository, options: ExecutionBrokerOptions) {
    this.options = { ...options, profiles: structuredClone(options.profiles) };
    this.now = options.now ?? Date.now;
    this.receipts.interruptUnreconciled();
  }

  prepare(principal: ExecutionPrincipal, value: unknown): ExecutionReceipt {
    this.requireRuntime();
    let plan: ExecutionPlan;
    try {
      plan = parseExecutionPlan(value, this.options.profiles);
    } catch {
      throw new ExecutionBrokerError("INVALID_REQUEST");
    }
    this.authorize(principal, plan);
    const owner = this.owner(principal);
    const fingerprint = this.receipts.fingerprint(plan);
    const existing = this.receipts.find(plan.executionId);
    if (existing) {
      if (existing.owner !== owner || existing.fingerprint !== fingerprint) throw new ExecutionBrokerError("CONFLICT");
      return this.snapshot(existing);
    }
    this.requireReconciled();
    const receipt = this.receipts.reserve(owner, plan.executionId, fingerprint);
    this.plans.set(plan.executionId, plan);
    return this.snapshot(receipt);
  }

  get(principal: ExecutionPrincipal, executionId: string): ExecutionReceipt {
    return this.snapshot(this.owned(principal, executionId));
  }

  readEvents(principal: ExecutionPrincipal, executionId: string, afterSequence: number): ExecutionEventPage {
    const receipt = this.owned(principal, executionId);
    const runtime = this.requireRuntime();
    const plan = this.plans.get(executionId);
    if (plan?.mode !== "public" || plan.inputs.length || !runtime.readEvents ||
      receipt.status === "prepared" || receipt.status === "start_committed") {
      throw new ExecutionBrokerError("CONFLICT");
    }
    if (!Number.isSafeInteger(afterSequence) || afterSequence < -1) throw new ExecutionBrokerError("INVALID_REQUEST");
    try {
      return runtime.readEvents(executionId, afterSequence, 10);
    } catch {
      throw new ExecutionBrokerError("UNAVAILABLE");
    }
  }

  inputLimit(principal: ExecutionPrincipal, executionId: string, slotId: string): number {
    this.owned(principal, executionId);
    const plan = this.plans.get(executionId);
    const slot = plan?.inputs.find((slot) => slot.id === slotId);
    if (!slot) throw new ExecutionBrokerError("NOT_FOUND");
    return slot.maximumBytes;
  }

  async putInput(principal: ExecutionPrincipal, executionId: string, slotId: string, bytes: Uint8Array): Promise<ExecutionReceipt> {
    const runtime = this.requireRuntime();
    const receipt = this.owned(principal, executionId);
    const plan = this.plans.get(executionId);
    if (!plan || receipt.status !== "prepared" || this.writing.has(executionId)) throw new ExecutionBrokerError("CONFLICT");
    this.requireReconciled();
    this.authorize(principal, plan);
    const slot = plan.inputs.find((slot) => slot.id === slotId);
    if (!slot || bytes.byteLength > slot.maximumBytes) throw new ExecutionBrokerError("INVALID_REQUEST");
    const copy = Uint8Array.from(bytes);
    const fingerprint = this.receipts.fingerprint({ slotId, bytes: Buffer.from(copy).toString("base64") });
    if (Object.hasOwn(receipt.sealedInputs, slotId)) {
      copy.fill(0);
      if (receipt.sealedInputs[slotId] !== fingerprint) throw new ExecutionBrokerError("CONFLICT");
      return this.snapshot(receipt);
    }
    this.writing.add(executionId);
    try {
      await runtime.putInput(structuredClone(plan), { ...slot }, copy);
      this.authorize(principal, plan);
      this.receipts.sealInput(executionId, slotId, fingerprint);
      return this.get(principal, executionId);
    } catch {
      this.receipts.markInterrupted(executionId);
      throw new ExecutionBrokerError("UNAVAILABLE");
    } finally {
      copy.fill(0);
      this.writing.delete(executionId);
    }
  }

  async start(principal: ExecutionPrincipal, executionId: string): Promise<ExecutionReceipt> {
    const runtime = this.requireRuntime();
    const receipt = this.owned(principal, executionId);
    if (["start_committed", "started", "interrupted", "closed"].includes(receipt.status)) return this.snapshot(receipt);
    const plan = this.plans.get(executionId);
    if (!plan || this.writing.has(executionId) || plan.inputs.some((slot) => !Object.hasOwn(receipt.sealedInputs, slot.id))) {
      throw new ExecutionBrokerError("CONFLICT");
    }
    this.requireReconciled();
    this.authorize(principal, plan);
    this.receipts.commitStart(executionId);
    try {
      await runtime.start(structuredClone(plan));
      this.receipts.markStarted(executionId);
    } catch {
      this.receipts.markInterrupted(executionId);
      throw new ExecutionBrokerError("UNAVAILABLE");
    }
    return this.get(principal, executionId);
  }

  private authorize(principal: ExecutionPrincipal, plan: ExecutionPlan): void {
    const approval = this.options.readAuthorization(principal, plan.authorizationId);
    if (!approval || !Number.isFinite(approval.expiresAt) || approval.expiresAt <= this.now() ||
      this.owner(approval.principal) !== this.owner(principal)) throw new ExecutionBrokerError("UNAUTHORIZED");
    let approved: ExecutionPlan;
    try {
      approved = parseExecutionPlan(approval.plan, this.options.profiles);
    } catch {
      throw new ExecutionBrokerError("UNAUTHORIZED");
    }
    if (this.receipts.fingerprint(approved) !== this.receipts.fingerprint(plan)) throw new ExecutionBrokerError("UNAUTHORIZED");
  }

  private owned(principal: ExecutionPrincipal, executionId: string): StoredExecutionReceipt {
    try { requireExecutionId(executionId); } catch { throw new ExecutionBrokerError("INVALID_REQUEST"); }
    const receipt = this.receipts.find(executionId);
    if (!receipt || receipt.owner !== this.owner(principal)) throw new ExecutionBrokerError("NOT_FOUND");
    return receipt;
  }

  private owner(principal: ExecutionPrincipal): string {
    return this.receipts.fingerprint([principal.installationId, principal.instanceId]);
  }

  private snapshot(receipt: StoredExecutionReceipt): ExecutionReceipt {
    return { executionId: receipt.executionId, status: receipt.status, cleanup: receipt.cleanup };
  }

  private requireRuntime() {
    if (!this.options.runtime) throw new ExecutionBrokerError("UNAVAILABLE");
    return this.options.runtime;
  }

  private requireReconciled(): void {
    if (this.receipts.hasInterrupted()) throw new ExecutionBrokerError("UNAVAILABLE");
  }
}
