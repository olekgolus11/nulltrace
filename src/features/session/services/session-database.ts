import { mkdirSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { Database } from "bun:sqlite";

function getAppDataDirectory() {
  if (process.env.XDG_DATA_HOME) {
    return join(process.env.XDG_DATA_HOME, "nulltrace");
  }

  if (process.platform === "darwin") {
    return join(homedir(), "Library", "Application Support", "nulltrace");
  }

  if (process.platform === "win32") {
    const appDataDirectory =
      process.env.APPDATA ?? join(homedir(), "AppData", "Roaming");
    return join(appDataDirectory, "nulltrace");
  }

  return join(homedir(), ".local", "share", "nulltrace");
}

const appDataDirectory = getAppDataDirectory();
mkdirSync(appDataDirectory, { recursive: true });

const databasePath = join(appDataDirectory, "nulltrace.sqlite");

export const sessionDatabase = new Database(databasePath, {
  create: true,
  strict: true,
});

sessionDatabase.exec("PRAGMA journal_mode = WAL;");
sessionDatabase.exec("PRAGMA foreign_keys = ON;");

sessionDatabase.exec(`
  CREATE TABLE IF NOT EXISTS targets (
    id TEXT PRIMARY KEY,
    normalized_url TEXT NOT NULL UNIQUE,
    display_url TEXT NOT NULL,
    created_at TEXT NOT NULL
  );

  CREATE TABLE IF NOT EXISTS sessions (
    id TEXT PRIMARY KEY,
    target_id TEXT NOT NULL,
    created_at TEXT NOT NULL,
    last_activity_at TEXT NOT NULL,
    FOREIGN KEY (target_id) REFERENCES targets(id) ON DELETE CASCADE
  );

  CREATE TABLE IF NOT EXISTS tool_runs (
    id TEXT PRIMARY KEY,
    session_id TEXT NOT NULL,
    tool_name TEXT NOT NULL,
    command TEXT NOT NULL,
    command_source TEXT NOT NULL,
    status TEXT NOT NULL,
    started_at TEXT NOT NULL,
    ended_at TEXT,
    exit_code INTEGER,
    FOREIGN KEY (session_id) REFERENCES sessions(id) ON DELETE CASCADE
  );

  CREATE TABLE IF NOT EXISTS tool_run_logs (
    id TEXT PRIMARY KEY,
    tool_run_id TEXT NOT NULL,
    seq INTEGER NOT NULL,
    stream TEXT NOT NULL,
    line TEXT NOT NULL,
    created_at TEXT NOT NULL,
    FOREIGN KEY (tool_run_id) REFERENCES tool_runs(id) ON DELETE CASCADE
  );

  CREATE TABLE IF NOT EXISTS finding_snapshots (
    id TEXT PRIMARY KEY,
    session_id TEXT NOT NULL,
    tool_run_id TEXT,
    source_tool TEXT NOT NULL,
    kind TEXT NOT NULL,
    severity TEXT NOT NULL,
    title TEXT NOT NULL,
    payload_json TEXT NOT NULL,
    created_at TEXT NOT NULL,
    FOREIGN KEY (session_id) REFERENCES sessions(id) ON DELETE CASCADE,
    FOREIGN KEY (tool_run_id) REFERENCES tool_runs(id) ON DELETE SET NULL
  );

  CREATE INDEX IF NOT EXISTS idx_targets_normalized_url
    ON targets(normalized_url);
  CREATE INDEX IF NOT EXISTS idx_sessions_target_id
    ON sessions(target_id);
  CREATE INDEX IF NOT EXISTS idx_sessions_last_activity_at
    ON sessions(last_activity_at DESC);
  CREATE INDEX IF NOT EXISTS idx_tool_runs_session_id
    ON tool_runs(session_id);
  CREATE INDEX IF NOT EXISTS idx_tool_run_logs_tool_run_id_seq
    ON tool_run_logs(tool_run_id, seq);
  CREATE INDEX IF NOT EXISTS idx_finding_snapshots_session_id
    ON finding_snapshots(session_id);
`);
