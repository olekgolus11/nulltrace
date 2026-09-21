import { createHmac } from "node:crypto";
import { Database } from "bun:sqlite";
import { ExecutionAdmissionStatus, StoredExecutionReceipt } from "../types/execution-broker.types";
import { ExecutionBrokerError } from "./execution-broker.error";

export class ExecutionReceiptRepository {
  private readonly key: Uint8Array;

  constructor(private readonly database: Database, key: Uint8Array, private readonly capacity = 10_000) {
    if (key.byteLength !== 32 || !Number.isSafeInteger(capacity) || capacity < 1) {
      throw new Error("Invalid execution receipt configuration.");
    }
    this.key = Uint8Array.from(key);
    this.database.exec(`CREATE TABLE IF NOT EXISTS execution_receipts (
      execution_id TEXT PRIMARY KEY,
      owner TEXT NOT NULL,
      fingerprint TEXT NOT NULL,
      status TEXT NOT NULL,
      cleanup TEXT NOT NULL DEFAULT 'pending',
      sealed_inputs TEXT NOT NULL DEFAULT '{}'
    )`);
  }

  fingerprint(value: unknown): string {
    return createHmac("sha256", this.key).update(JSON.stringify(value)).digest("hex");
  }

  find(executionId: string): StoredExecutionReceipt | null {
    const row = this.database.query<ReceiptRow, [string]>(
      "SELECT * FROM execution_receipts WHERE execution_id = ?",
    ).get(executionId);
    return row ? {
      executionId: row.execution_id,
      owner: row.owner,
      fingerprint: row.fingerprint,
      status: row.status,
      cleanup: row.cleanup,
      sealedInputs: JSON.parse(row.sealed_inputs),
    } : null;
  }

  reserve(owner: string, executionId: string, fingerprint: string): StoredExecutionReceipt {
    return this.database.transaction(() => {
      const existing = this.find(executionId);
      if (existing) {
        if (existing.owner !== owner || existing.fingerprint !== fingerprint) throw new ExecutionBrokerError("CONFLICT");
        return existing;
      }
      const active = this.database.query<{ execution_id: string }, [string]>(
        "SELECT execution_id FROM execution_receipts WHERE owner = ? AND cleanup = 'pending' LIMIT 1",
      ).get(owner);
      if (active) throw new ExecutionBrokerError("CONFLICT");
      const count = this.database.query<{ count: number }, []>("SELECT COUNT(*) AS count FROM execution_receipts").get()!.count;
      if (count >= this.capacity) throw new ExecutionBrokerError("CAPACITY");
      this.database.query("INSERT INTO execution_receipts(execution_id, owner, fingerprint, status) VALUES (?, ?, ?, 'prepared')")
        .run(executionId, owner, fingerprint);
      return this.find(executionId)!;
    }).immediate();
  }

  sealInput(executionId: string, slotId: string, fingerprint: string): void {
    this.database.transaction(() => {
      const receipt = this.find(executionId);
      if (!receipt || receipt.status !== "prepared") throw new ExecutionBrokerError("CONFLICT");
      this.database.query("UPDATE execution_receipts SET sealed_inputs = ? WHERE execution_id = ?")
        .run(JSON.stringify({ ...receipt.sealedInputs, [slotId]: fingerprint }), executionId);
    }).immediate();
  }

  commitStart(executionId: string): void {
    const result = this.database.query(
      "UPDATE execution_receipts SET status = 'start_committed' WHERE execution_id = ? AND status = 'prepared'",
    ).run(executionId);
    if (result.changes !== 1) throw new ExecutionBrokerError("CONFLICT");
  }

  markStarted(executionId: string): void {
    this.database.query("UPDATE execution_receipts SET status = 'started' WHERE execution_id = ? AND status = 'start_committed'")
      .run(executionId);
  }

  markInterrupted(executionId: string): void {
    this.database.query("UPDATE execution_receipts SET status = 'interrupted' WHERE execution_id = ? AND cleanup = 'pending'")
      .run(executionId);
  }

  interruptUnreconciled(): void {
    this.database.exec("UPDATE execution_receipts SET status = 'interrupted' WHERE cleanup = 'pending'");
  }

  hasInterrupted(): boolean {
    return Boolean(this.database.query("SELECT 1 FROM execution_receipts WHERE status = 'interrupted' LIMIT 1").get());
  }

  confirmCleanup(executionId: string): void {
    this.database.query("UPDATE execution_receipts SET status = 'closed', cleanup = 'confirmed', sealed_inputs = '{}' WHERE execution_id = ?")
      .run(executionId);
  }
}

interface ReceiptRow {
  execution_id: string;
  owner: string;
  fingerprint: string;
  status: ExecutionAdmissionStatus;
  cleanup: "pending" | "confirmed";
  sealed_inputs: string;
}
