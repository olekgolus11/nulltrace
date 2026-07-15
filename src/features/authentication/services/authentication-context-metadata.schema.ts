import { Database } from "bun:sqlite";

export function createAuthenticationContextMetadataTable(database: Database) {
  database.exec(`
    CREATE TABLE IF NOT EXISTS session_authentication_context_metadata (
      session_id TEXT PRIMARY KEY,
      runtime_id TEXT NOT NULL,
      origin TEXT NOT NULL,
      cookie_count INTEGER NOT NULL,
      header_names_json TEXT NOT NULL,
      storage_mode TEXT NOT NULL,
      import_source TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      auth_check_json TEXT NOT NULL,
      FOREIGN KEY (session_id) REFERENCES sessions(id) ON DELETE CASCADE
    );
  `);
}
