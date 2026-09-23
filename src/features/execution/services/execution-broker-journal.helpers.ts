import { createHmac, timingSafeEqual } from "node:crypto";
import { Database } from "bun:sqlite";

export function provisionExecutionBrokerJournal(database: Database, installationId: string, key: Uint8Array): void {
  if (!/^[A-Za-z0-9_-]{1,96}$/.test(installationId) || key.byteLength !== 32) {
    throw new Error("Invalid execution broker installation identity.");
  }
  database.exec("CREATE TABLE IF NOT EXISTS execution_broker_installation (id INTEGER PRIMARY KEY CHECK (id = 1), marker BLOB NOT NULL)");
  const marker = createHmac("sha256", key).update(`nulltrace-journal-v1:${installationId}`).digest();
  const existing = database.query<{ marker: Uint8Array }, []>(
    "SELECT marker FROM execution_broker_installation WHERE id = 1",
  ).get();
  if (existing) {
    if (existing.marker.byteLength !== marker.byteLength || !timingSafeEqual(Buffer.from(existing.marker), marker)) {
      throw new Error("Execution broker journal identity mismatch.");
    }
    return;
  }
  database.query("INSERT INTO execution_broker_installation(id, marker) VALUES (1, ?)").run(marker);
}

export function assertExecutionBrokerJournal(database: Database, installationId: string, key: Uint8Array): void {
  if (!/^[A-Za-z0-9_-]{1,96}$/.test(installationId) || key.byteLength !== 32) {
    throw new Error("Invalid execution broker installation identity.");
  }
  let stored: Uint8Array | undefined;
  try {
    stored = database.query<{ marker: Uint8Array }, []>(
      "SELECT marker FROM execution_broker_installation WHERE id = 1",
    ).get()?.marker;
  } catch {
    throw new Error("Execution broker journal was not provisioned.");
  }
  const expected = createHmac("sha256", key).update(`nulltrace-journal-v1:${installationId}`).digest();
  if (!stored || stored.byteLength !== expected.byteLength || !timingSafeEqual(Buffer.from(stored), expected)) {
    throw new Error("Execution broker journal identity mismatch.");
  }
}
