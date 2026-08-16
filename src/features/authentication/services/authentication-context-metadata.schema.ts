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
      local_storage_entry_count INTEGER NOT NULL DEFAULT 0,
      session_storage_entry_count INTEGER NOT NULL DEFAULT 0,
      FOREIGN KEY (session_id) REFERENCES sessions(id) ON DELETE CASCADE
    );
  `);

  const columns = new Set(
    database
      .query<{ name: string }, []>("PRAGMA table_info(session_authentication_context_metadata)")
      .all()
      .map((column) => column.name),
  );
  if (!columns.has("local_storage_entry_count")) {
    database.exec(
      "ALTER TABLE session_authentication_context_metadata ADD COLUMN local_storage_entry_count INTEGER NOT NULL DEFAULT 0",
    );
  }
  if (!columns.has("session_storage_entry_count")) {
    database.exec(
      "ALTER TABLE session_authentication_context_metadata ADD COLUMN session_storage_entry_count INTEGER NOT NULL DEFAULT 0",
    );
  }
}
