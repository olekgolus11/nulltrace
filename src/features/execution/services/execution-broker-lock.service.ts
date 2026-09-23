import { Database } from "bun:sqlite";
import { ExecutionBrokerOwnershipLock } from "../types/execution-broker-lock.types";

export class ExecutionBrokerLockService implements ExecutionBrokerOwnershipLock {
  private readonly database: Database;
  private released = false;

  constructor(path: string) {
    if (!path || path === ":memory:") throw new Error("Broker lock requires a private durable path.");
    this.database = new Database(path, { create: true });
    try {
      this.database.exec("PRAGMA busy_timeout = 0");
      this.database.exec("BEGIN EXCLUSIVE");
    } catch {
      this.database.close();
      throw new Error("Another execution broker may own this installation.");
    }
  }

  assertHeld(): void {
    if (this.released) throw new Error("Execution broker ownership lock was released.");
  }

  release(): void {
    if (this.released) return;
    this.released = true;
    try {
      this.database.exec("ROLLBACK");
    } finally {
      this.database.close();
    }
  }
}
