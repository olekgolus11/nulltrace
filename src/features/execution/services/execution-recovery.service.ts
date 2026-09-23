import { ExecutionResourceReconciler } from "../types/execution-recovery.types";
import { ExecutionReceiptRepository } from "./execution-receipt.repository";

export class ExecutionRecoveryService {
  constructor(
    private readonly receipts: ExecutionReceiptRepository,
    private readonly resources: ExecutionResourceReconciler,
  ) {}

  async reconcile(): Promise<number> {
    const pending = this.receipts.listPending();
    await this.resources.reconcileOwnedResources();
    for (const receipt of pending) this.receipts.confirmCleanup(receipt.executionId);
    return pending.length;
  }
}
