import { Database } from "bun:sqlite";

export function createSessionReportDraftsTable(database: Database) {
  database.exec(`
    CREATE TABLE IF NOT EXISTS session_report_drafts (
      id TEXT PRIMARY KEY,
      session_id TEXT NOT NULL UNIQUE,
      selected_finding_ids_json TEXT NOT NULL,
      markdown TEXT NOT NULL,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      FOREIGN KEY (session_id) REFERENCES sessions(id) ON DELETE CASCADE
    );
  `);
}
