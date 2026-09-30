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
      context_generation INTEGER,
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
  if (!columns.has("context_generation")) {
    database.exec(
      "ALTER TABLE session_authentication_context_metadata ADD COLUMN context_generation INTEGER",
    );
  }

  database.exec(`
    CREATE TABLE IF NOT EXISTS session_authentication_context_state (
      session_id TEXT PRIMARY KEY,
      generation INTEGER NOT NULL CHECK (generation >= 0 AND generation <= 9007199254740991),
      status TEXT NOT NULL CHECK (status IN ('saving', 'active', 'clear_pending', 'cleared')),
      storage_mode TEXT CHECK (storage_mode IS NULL OR storage_mode IN ('memory', 'secure')),
      CHECK ((status = 'active' AND storage_mode IS NOT NULL) OR (status != 'active' AND storage_mode IS NULL)),
      FOREIGN KEY (session_id) REFERENCES sessions(id) ON DELETE CASCADE
    );
    CREATE TABLE IF NOT EXISTS session_authentication_context_secret_keys (
      session_id TEXT NOT NULL,
      generation INTEGER NOT NULL CHECK (generation >= 0 AND generation <= 9007199254740991),
      status TEXT NOT NULL CHECK (status IN ('writing', 'pending', 'stored', 'delete_pending', 'deleted')),
      PRIMARY KEY (session_id, generation),
      FOREIGN KEY (session_id) REFERENCES sessions(id) ON DELETE CASCADE
    );
    CREATE INDEX IF NOT EXISTS idx_auth_context_secret_keys_cleanup
      ON session_authentication_context_secret_keys(session_id, status, generation);
  `);
}
