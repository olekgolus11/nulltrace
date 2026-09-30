import {
  ExecutionBrokerOptions,
  ExecutionControlReceipt,
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
  private readonly cancelling = new Set<string>();
  private readonly writeWaiters = new Map<string, Promise<void>>();
  private readonly starting = new Map<string, Promise<void>>();
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

  async cancel(principal: ExecutionPrincipal, executionId: string): Promise<ExecutionControlReceipt> {
    let receipt = this.owned(principal, executionId);
    if (receipt.status === "closed") return this.status(principal, executionId);
    this.cancelling.add(executionId);
    const runtime = this.requireRuntime();
    if (receipt.status === "prepared" && this.writing.has(executionId)) {
      await this.writeWaiters.get(executionId);
      receipt = this.owned(principal, executionId);
    }
    if (receipt.status === "closed") return this.status(principal, executionId);
    if (receipt.status === "prepared") {
      runtime.discardInputs?.(executionId);
      this.receipts.cancelPrepared(executionId);
      this.plans.delete(executionId);
      return { executionId, status: "finished", stopReason: "cancelled", cleanup: "confirmed", exitCode: null };
    }
    if (receipt.status === "start_committed") {
      const starting = this.starting.get(executionId);
      if (!starting) throw new ExecutionBrokerError("UNAVAILABLE");
      await starting.catch(() => undefined);
      receipt = this.owned(principal, executionId);
      if (receipt.status === "closed") return this.status(principal, executionId);
      if (receipt.status === "interrupted") return this.status(principal, executionId);
    }
    if (!runtime.cancel) throw new ExecutionBrokerError("UNAVAILABLE");
    try {
      return runtime.cancel(executionId);
    } catch {
      throw new ExecutionBrokerError("UNAVAILABLE");
    }
  }

  status(principal: ExecutionPrincipal, executionId: string): ExecutionControlReceipt {
    const receipt = this.owned(principal, executionId);
    if (receipt.status === "closed") {
      const outcome = this.receipts.findOutcome(executionId);
      if (outcome) return {
        executionId,
        status: "finished",
        stopReason: outcome.cause === "cancelled" || outcome.cause === "lease_expired" || outcome.cause === "deadline" ? outcome.cause : null,
        cleanup: outcome.cleanup,
        exitCode: outcome.exitCode,
      };
      return { executionId, status: "finished", stopReason: null, cleanup: "confirmed", exitCode: null };
    }
    if (receipt.status === "prepared" || receipt.status === "start_committed") {
      return { executionId, status: "running", stopReason: null, cleanup: "pending", exitCode: null };
    }
    if (receipt.status === "interrupted") {
      try {
        if (!this.options.runtime?.getControl) throw new Error();
        return this.options.runtime.getControl(executionId);
      } catch {
        return { executionId, status: "interrupted", stopReason: null, cleanup: "pending", exitCode: null };
      }
    }
    if (!this.options.runtime?.getControl) throw new ExecutionBrokerError("UNAVAILABLE");
    try { return this.options.runtime.getControl(executionId); }
    catch { throw new ExecutionBrokerError("UNAVAILABLE"); }
  }

  renewOwnership(principal: ExecutionPrincipal, executionId: string): ExecutionControlReceipt {
    const receipt = this.owned(principal, executionId);
    if (receipt.status !== "started" || receipt.cleanup !== "pending") throw new ExecutionBrokerError("CONFLICT");
    const runtime = this.requireRuntime();
    if (!runtime.renewOwnership) throw new ExecutionBrokerError("UNAVAILABLE");
    try {
      return runtime.renewOwnership(executionId);
    } catch {
      throw new ExecutionBrokerError("CONFLICT");
    }
  }

  readEvents(principal: ExecutionPrincipal, executionId: string, afterSequence: number): ExecutionEventPage {
    const receipt = this.owned(principal, executionId);
    const runtime = this.requireRuntime();
    const plan = this.plans.get(executionId);
    const isLegacyPublicPlan = plan?.mode === "public" && plan.inputs.length === 0;
    const isApprovedPublicDataPlan = plan?.mode === "public-worker" &&
      this.options.publicDataEventProfileIds?.includes(plan.profileId) === true &&
      plan.inputs.length > 0 && plan.inputs.every((input) => input.kind === "data");
    if ((!isLegacyPublicPlan && !isApprovedPublicDataPlan) || !runtime.readEvents ||
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
    if (!plan || receipt.status !== "prepared" || this.writing.has(executionId) || this.cancelling.has(executionId)) throw new ExecutionBrokerError("CONFLICT");
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
    let resolveWrite!: () => void;
    const writeFinished = new Promise<void>((resolve) => { resolveWrite = resolve; });
    this.writeWaiters.set(executionId, writeFinished);
    try {
      await runtime.putInput(structuredClone(plan), { ...slot }, copy);
      this.authorize(principal, plan);
      this.receipts.sealInput(executionId, slotId, fingerprint);
      return this.get(principal, executionId);
    } catch {
      try { runtime.discardInputs?.(executionId); }
      finally { this.receipts.markInterrupted(executionId); }
      throw new ExecutionBrokerError("UNAVAILABLE");
    } finally {
      copy.fill(0);
      this.writing.delete(executionId);
      resolveWrite();
      this.writeWaiters.delete(executionId);
    }
  }

  async start(principal: ExecutionPrincipal, executionId: string): Promise<ExecutionReceipt> {
    const runtime = this.requireRuntime();
    const receipt = this.owned(principal, executionId);
    if (["start_committed", "started", "interrupted", "closed"].includes(receipt.status)) return this.snapshot(receipt);
    const plan = this.plans.get(executionId);
    if (!plan || this.writing.has(executionId) || this.cancelling.has(executionId) || plan.inputs.some((slot) => !Object.hasOwn(receipt.sealedInputs, slot.id))) {
      throw new ExecutionBrokerError("CONFLICT");
    }
    try {
      this.requireReconciled();
      this.authorize(principal, plan);
      this.receipts.commitStart(executionId);
    } catch (error) {
      if (plan.inputs.length) {
        try { runtime.discardInputs?.(executionId); }
        finally { this.receipts.markInterrupted(executionId); }
      }
      throw error;
    }
    const starting = (async () => {
      try {
        await runtime.start(structuredClone(plan));
        this.receipts.markStarted(executionId);
      } catch {
        try { runtime.discardInputs?.(executionId); }
        finally { this.receipts.markInterrupted(executionId); }
        throw new ExecutionBrokerError("UNAVAILABLE");
      }
    })();
    this.starting.set(executionId, starting);
    try { await starting; }
    finally { if (this.starting.get(executionId) === starting) this.starting.delete(executionId); }
    return this.get(principal, executionId);
  }

  private authorize(principal: ExecutionPrincipal, plan: ExecutionPlan): void {
    const approval = this.options.readAuthorization(principal, plan.authorizationId, plan);
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
