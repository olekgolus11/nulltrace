import { createHmac } from "node:crypto";
import { Database } from "bun:sqlite";
import { ExecutionAdmissionStatus, ExecutionCredentialBinding, ExecutionOutcome, StoredExecutionReceipt } from "../types/execution-broker.types";
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
      sealed_inputs TEXT NOT NULL DEFAULT '{}',
      credential_scope_id TEXT,
      credential_generation INTEGER,
      credential_revoked INTEGER NOT NULL DEFAULT 0,
      installation_owner TEXT NOT NULL DEFAULT ''
    )`);
    const columns = new Set(this.database.query<{ name: string }, []>("PRAGMA table_info(execution_receipts)").all().map(({ name }) => name));
    if (!columns.has("credential_scope_id")) this.database.exec("ALTER TABLE execution_receipts ADD COLUMN credential_scope_id TEXT");
    if (!columns.has("credential_generation")) this.database.exec("ALTER TABLE execution_receipts ADD COLUMN credential_generation INTEGER");
    if (!columns.has("credential_revoked")) this.database.exec("ALTER TABLE execution_receipts ADD COLUMN credential_revoked INTEGER NOT NULL DEFAULT 0");
    if (!columns.has("installation_owner")) this.database.exec("ALTER TABLE execution_receipts ADD COLUMN installation_owner TEXT NOT NULL DEFAULT ''");
    this.database.exec(`CREATE TABLE IF NOT EXISTS execution_outcomes (
      execution_id TEXT PRIMARY KEY,
      cause TEXT NOT NULL,
      exit_code INTEGER,
      cleanup TEXT NOT NULL
    )`);
  }

  fingerprint(value: unknown): string {
    return createHmac("sha256", this.key).update(JSON.stringify(value)).digest("hex");
  }

  find(executionId: string): StoredExecutionReceipt | null {
    const row = this.database.query<ReceiptRow, [string]>(
      "SELECT * FROM execution_receipts WHERE execution_id = ?",
    ).get(executionId);
    if (!row) return null;
    const noBinding = row.credential_scope_id === null && row.credential_generation === null;
    const hasBinding = typeof row.credential_scope_id === "string" && row.credential_generation !== null;
    if ((!noBinding && !hasBinding) || ![0, 1].includes(row.credential_revoked) ||
      (hasBinding && (!/^[A-Za-z0-9_-]{1,128}$/.test(row.credential_scope_id!) ||
        !Number.isSafeInteger(row.credential_generation) || row.credential_generation! < 0))) {
      throw new Error("Execution credential binding journal is malformed.");
    }
    return {
      executionId: row.execution_id,
      owner: row.owner,
      fingerprint: row.fingerprint,
      status: row.status,
      cleanup: row.cleanup,
      sealedInputs: JSON.parse(row.sealed_inputs),
      credentialBinding: noBinding ? null : { scopeId: row.credential_scope_id!, generation: row.credential_generation! },
      credentialRevoked: row.credential_revoked === 1,
    };
  }

  reserve(owner: string, executionId: string, fingerprint: string, binding: ExecutionCredentialBinding | null = null, installationOwner = owner): StoredExecutionReceipt {
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
      this.database.query(`INSERT INTO execution_receipts(
        execution_id, owner, fingerprint, status, credential_scope_id, credential_generation, installation_owner
      ) VALUES (?, ?, ?, 'prepared', ?, ?, ?)`)
        .run(executionId, owner, fingerprint, binding?.scopeId ?? null, binding?.generation ?? null, installationOwner);
      return this.find(executionId)!;
    }).immediate();
  }

  sealInput(executionId: string, slotId: string, fingerprint: string): void {
    this.database.transaction(() => {
      const receipt = this.find(executionId);
      if (!receipt || receipt.status !== "prepared" || receipt.credentialRevoked) throw new ExecutionBrokerError("CONFLICT");
      this.database.query("UPDATE execution_receipts SET sealed_inputs = ? WHERE execution_id = ?")
        .run(JSON.stringify({ ...receipt.sealedInputs, [slotId]: fingerprint }), executionId);
    }).immediate();
  }

  commitStart(executionId: string): void {
    const result = this.database.query(
      "UPDATE execution_receipts SET status = 'start_committed' WHERE execution_id = ? AND status = 'prepared' AND credential_revoked = 0",
    ).run(executionId);
    if (result.changes !== 1) throw new ExecutionBrokerError("CONFLICT");
  }

  revokeCredentialBinding(installationOwner: string, binding: ExecutionCredentialBinding): StoredExecutionReceipt[] {
    this.database.transaction(() => {
      this.database.query(`UPDATE execution_receipts SET credential_revoked = 1
        WHERE installation_owner = ? AND credential_scope_id = ? AND credential_generation = ? AND cleanup = 'pending'`)
        .run(installationOwner, binding.scopeId, binding.generation);
    }).immediate();
    return this.listCredentialBinding(installationOwner, binding);
  }

  listCredentialBinding(installationOwner: string, binding: ExecutionCredentialBinding): StoredExecutionReceipt[] {
    const rows = this.database.query<{ execution_id: string }, [string, string, number]>(
      `SELECT execution_id FROM execution_receipts
       WHERE installation_owner = ? AND credential_scope_id = ? AND credential_generation = ? AND cleanup = 'pending'`,
    ).all(installationOwner, binding.scopeId, binding.generation);
    return rows.map(({ execution_id }) => this.find(execution_id)!);
  }

  markStarted(executionId: string): void {
    this.database.query("UPDATE execution_receipts SET status = 'started' WHERE execution_id = ? AND status = 'start_committed'")
      .run(executionId);
  }

  markInterrupted(executionId: string): void {
    this.database.query("UPDATE execution_receipts SET status = 'interrupted' WHERE execution_id = ? AND cleanup = 'pending'")
      .run(executionId);
  }

  cancelPrepared(executionId: string): void {
    this.database.transaction(() => {
      const result = this.database.query(
        "UPDATE execution_receipts SET status = 'closed', cleanup = 'confirmed', sealed_inputs = '{}' WHERE execution_id = ? AND status = 'prepared' AND cleanup = 'pending' AND credential_revoked = 0",
      ).run(executionId);
      if (result.changes !== 1) throw new ExecutionBrokerError("CONFLICT");
      this.database.query("INSERT INTO execution_outcomes(execution_id, cause, exit_code, cleanup) VALUES (?, 'cancelled', NULL, 'confirmed')")
        .run(executionId);
    }).immediate();
  }

  closeRevokedPrepared(executionId: string): void {
    this.database.transaction(() => {
      const result = this.database.query(
        "UPDATE execution_receipts SET status = 'closed', cleanup = 'confirmed', sealed_inputs = '{}' WHERE execution_id = ? AND status IN ('prepared', 'interrupted') AND cleanup = 'pending' AND credential_revoked = 1",
      ).run(executionId);
      if (result.changes !== 1) throw new ExecutionBrokerError("CONFLICT");
      this.database.query("INSERT INTO execution_outcomes(execution_id, cause, exit_code, cleanup) VALUES (?, 'cancelled', NULL, 'confirmed')")
        .run(executionId);
    }).immediate();
  }

  interruptUnreconciled(): void {
    this.database.exec("UPDATE execution_receipts SET status = 'interrupted' WHERE cleanup = 'pending'");
  }

  hasInterrupted(): boolean {
    return Boolean(this.database.query("SELECT 1 FROM execution_receipts WHERE status = 'interrupted' LIMIT 1").get());
  }

  listPending(): StoredExecutionReceipt[] {
    const rows = this.database.query<{ execution_id: string }, []>(
      "SELECT execution_id FROM execution_receipts WHERE cleanup = 'pending' ORDER BY execution_id",
    ).all();
    return rows.map(({ execution_id }) => this.find(execution_id)!);
  }

  confirmCleanup(executionId: string): void {
    this.database.transaction(() => {
      const result = this.database.query(
        "UPDATE execution_receipts SET status = 'closed', cleanup = 'confirmed', sealed_inputs = '{}' WHERE execution_id = ? AND cleanup = 'pending'",
      ).run(executionId);
      if (result.changes !== 1) throw new ExecutionBrokerError("CONFLICT");
      this.database.query("UPDATE execution_outcomes SET cleanup = 'confirmed' WHERE execution_id = ?").run(executionId);
    }).immediate();
  }

  recordOutcome(outcome: ExecutionOutcome): void {
    if (!Number.isSafeInteger(outcome.exitCode) && outcome.exitCode !== null) throw new Error("Invalid execution exit code.");
    if (outcome.exitCode !== null && (outcome.exitCode < 0 || outcome.exitCode > 255)) throw new Error("Invalid execution exit code.");
    if (!["normal", "nonzero_exit", "cancelled", "lease_expired", "deadline", "infrastructure"].includes(outcome.cause) ||
      !["pending", "confirmed"].includes(outcome.cleanup)) throw new Error("Invalid execution outcome.");
    this.database.transaction(() => {
      const receipt = this.find(outcome.executionId);
      if (!receipt || receipt.status === "prepared" || receipt.cleanup === "confirmed") throw new ExecutionBrokerError("CONFLICT");
      const existing = this.findOutcome(outcome.executionId);
      if (existing) throw new ExecutionBrokerError("CONFLICT");
      this.database.query("INSERT INTO execution_outcomes(execution_id, cause, exit_code, cleanup) VALUES (?, ?, ?, ?)")
        .run(outcome.executionId, outcome.cause, outcome.exitCode, outcome.cleanup);
      if (outcome.cleanup === "confirmed") this.confirmCleanup(outcome.executionId);
      else this.markInterrupted(outcome.executionId);
    }).immediate();
  }

  findOutcome(executionId: string): ExecutionOutcome | null {
    const row = this.database.query<OutcomeRow, [string]>(
      "SELECT * FROM execution_outcomes WHERE execution_id = ?",
    ).get(executionId);
    return row ? {
      executionId: row.execution_id,
      cause: row.cause,
      exitCode: row.exit_code,
      cleanup: row.cleanup,
    } : null;
  }
}

interface ReceiptRow {
  execution_id: string;
  owner: string;
  fingerprint: string;
  status: ExecutionAdmissionStatus;
  cleanup: "pending" | "confirmed";
  sealed_inputs: string;
  credential_scope_id: string | null;
  credential_generation: number | null;
  credential_revoked: number;
  installation_owner: string;
}

interface OutcomeRow {
  execution_id: string;
  cause: ExecutionOutcome["cause"];
  exit_code: number | null;
  cleanup: ExecutionOutcome["cleanup"];
}
