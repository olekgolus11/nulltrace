import { createHmac, timingSafeEqual } from "node:crypto";
import { Database } from "bun:sqlite";
import { ExecutionAuthorization, ExecutionPrincipal } from "../types/execution-broker.types";
import { ExecutionPlan, ExecutionProfile } from "../types/execution-plan.types";
import { parseExecutionPlan } from "./execution-plan.helpers";

interface AuthorizationRow {
  authorization_id: string;
  principal: string;
  plan: string;
  expires_at: number;
  execution_id: string | null;
  plan_fingerprint: string | null;
  mac: Uint8Array;
}

/** Broker-local ledger. Grant issuance is an administrative operation and is never exposed over the execution socket. */
export class ExecutionAuthorizationLedgerRepository {
  private readonly key: Uint8Array;

  constructor(
    private readonly database: Database,
    key: Uint8Array,
    private readonly profiles: ExecutionProfile[],
    private readonly now: () => number = Date.now,
    private readonly validatePlan: (plan: ExecutionPlan) => boolean = () => true,
  ) {
    if (key.byteLength !== 32) throw new Error("Invalid execution authorization key.");
    this.key = Uint8Array.from(key);
    this.database.exec(`CREATE TABLE IF NOT EXISTS execution_authorizations (
      authorization_id TEXT PRIMARY KEY,
      principal TEXT NOT NULL,
      plan TEXT NOT NULL,
      expires_at INTEGER NOT NULL,
      execution_id TEXT,
      plan_fingerprint TEXT,
      mac BLOB NOT NULL
    )`);
  }

  issue(principal: ExecutionPrincipal, value: unknown, expiresAt: number): boolean {
    const plan = parseExecutionPlan(value, this.profiles);
    if (!this.validatePlan(plan) || !validPrincipal(principal) || !Number.isSafeInteger(expiresAt) || expiresAt <= this.now() ||
      expiresAt - this.now() > 15 * 60_000) {
      throw new Error("Invalid execution authorization grant.");
    }
    const fields = {
      authorization_id: plan.authorizationId,
      principal: JSON.stringify(principal),
      plan: JSON.stringify(plan),
      expires_at: expiresAt,
      execution_id: null,
      plan_fingerprint: null,
    };
    const mac = this.sign(fields);
    return this.database.transaction(() => {
      if (this.database.query("SELECT 1 FROM execution_authorizations WHERE authorization_id = ?").get(fields.authorization_id)) return false;
      this.database.query(`INSERT INTO execution_authorizations
        (authorization_id, principal, plan, expires_at, execution_id, plan_fingerprint, mac)
        VALUES (?, ?, ?, ?, NULL, NULL, ?)`)
        .run(fields.authorization_id, fields.principal, fields.plan, fields.expires_at, mac);
      return true;
    }).immediate();
  }

  claim(principal: ExecutionPrincipal, authorizationId: string, requestedPlan: ExecutionPlan): ExecutionAuthorization | null {
    return this.database.transaction(() => {
      const row = this.database.query<AuthorizationRow, [string]>(
        "SELECT * FROM execution_authorizations WHERE authorization_id = ?",
      ).get(authorizationId);
      if (!row || !this.isAuthentic(row) || row.expires_at <= this.now()) return null;
      let storedPrincipal: unknown;
      let storedPlan: ExecutionPlan;
      try {
        storedPrincipal = JSON.parse(row.principal);
        storedPlan = parseExecutionPlan(JSON.parse(row.plan), this.profiles);
      } catch { return null; }
      if (!validPrincipal(storedPrincipal) || !samePrincipal(storedPrincipal, principal) ||
        storedPlan.authorizationId !== authorizationId) return null;
      const planFingerprint = this.fingerprint(requestedPlan);
      if (!this.validatePlan(storedPlan) || this.fingerprint(storedPlan) !== planFingerprint) return null;
      if (row.execution_id !== null &&
        (row.execution_id !== requestedPlan.executionId || row.plan_fingerprint !== planFingerprint)) return null;
      if (row.execution_id === null) {
        const next = { ...row, execution_id: requestedPlan.executionId, plan_fingerprint: planFingerprint };
        this.database.query(`UPDATE execution_authorizations SET execution_id = ?, plan_fingerprint = ?, mac = ?
          WHERE authorization_id = ? AND execution_id IS NULL`)
          .run(next.execution_id, next.plan_fingerprint, this.sign(next), authorizationId);
      }
      return { principal: storedPrincipal, plan: storedPlan, expiresAt: row.expires_at };
    }).immediate();
  }

  private isAuthentic(row: AuthorizationRow): boolean {
    const expected = this.sign(row);
    return row.mac.byteLength === expected.byteLength && timingSafeEqual(Buffer.from(row.mac), expected);
  }

  private sign(row: Pick<AuthorizationRow, "authorization_id" | "principal" | "plan" | "expires_at" | "execution_id" | "plan_fingerprint">): Buffer {
    return createHmac("sha256", this.key).update(JSON.stringify([
      "execution-authorization-v1", row.authorization_id, row.principal, row.plan, row.expires_at,
      row.execution_id, row.plan_fingerprint,
    ])).digest();
  }

  private fingerprint(value: unknown): string {
    return createHmac("sha256", this.key).update(JSON.stringify(value)).digest("hex");
  }
}

function validPrincipal(value: unknown): value is ExecutionPrincipal {
  return Boolean(value && typeof value === "object" && !Array.isArray(value) &&
    typeof (value as ExecutionPrincipal).installationId === "string" && /^[A-Za-z0-9_-]{1,96}$/.test((value as ExecutionPrincipal).installationId) &&
    typeof (value as ExecutionPrincipal).instanceId === "string" && /^[A-Za-z0-9_-]{1,96}$/.test((value as ExecutionPrincipal).instanceId));
}

function samePrincipal(left: ExecutionPrincipal, right: ExecutionPrincipal): boolean {
  return left.installationId === right.installationId && left.instanceId === right.instanceId;
}
