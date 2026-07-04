import { Database } from "bun:sqlite";

export function createActionDraftsTable(database: Database) {
  database.exec(`
    CREATE TABLE IF NOT EXISTS action_drafts (
      id TEXT PRIMARY KEY,
      session_id TEXT NOT NULL,
      opencode_conversation_id TEXT,
      target_tool TEXT NOT NULL,
      status TEXT NOT NULL CHECK (status IN ('draft', 'applied', 'dismissed', 'superseded')),
      title TEXT NOT NULL,
      summary TEXT NOT NULL,
      payload_json TEXT NOT NULL,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      FOREIGN KEY (session_id) REFERENCES sessions(id) ON DELETE CASCADE,
      FOREIGN KEY (opencode_conversation_id)
        REFERENCES conversation_attachments(opencode_conversation_id)
        ON DELETE SET NULL
    );

    CREATE INDEX IF NOT EXISTS idx_action_drafts_session_updated
      ON action_drafts(session_id, updated_at DESC);
    CREATE INDEX IF NOT EXISTS idx_action_drafts_conversation
      ON action_drafts(opencode_conversation_id);
  `);
}
