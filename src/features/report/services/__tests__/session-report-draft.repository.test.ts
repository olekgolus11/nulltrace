import { Database } from "bun:sqlite";
import { describe, expect, it } from "bun:test";
import { SessionReportDraftRepository } from "../session-report-draft.repository";
import { createSessionReportDraftsTable } from "../session-report-draft.schema";

function createTestDatabase() {
  const database = new Database(":memory:", { strict: true });
  database.exec("PRAGMA foreign_keys = ON;");
  database.exec(`
    CREATE TABLE sessions (
      id TEXT PRIMARY KEY,
      last_activity_at TEXT NOT NULL
    );
    INSERT INTO sessions (id, last_activity_at)
    VALUES ('session-1', '2026-08-01T10:00:00.000Z');
  `);
  createSessionReportDraftsTable(database);
  return database;
}

describe("SessionReportDraftRepository", () => {
  it("persists operator edits and current Finding selection for later reopening", () => {
    const repository = new SessionReportDraftRepository(createTestDatabase());

    const created = repository.save({
      sessionId: "session-1",
      selectedFindingIds: ["finding-1", "finding-2"],
      markdown: "# Initial generated draft",
    });
    const updated = repository.save({
      sessionId: "session-1",
      selectedFindingIds: ["finding-1"],
      markdown: "# Operator-edited draft\n\nVerified wording.",
    });

    expect(updated.id).toBe(created.id);
    expect(repository.findBySessionId("session-1")).toEqual({
      ...updated,
      selectedFindingIds: ["finding-1"],
      markdown: "# Operator-edited draft\n\nVerified wording.",
    });
  });
});
