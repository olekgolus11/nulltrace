import { mkdirSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { Database } from "bun:sqlite";
import { createActionDraftsTable } from "../../action-draft/services/action-draft.schema";
import { createAuthenticationContextMetadataTable } from "../../authentication/services/authentication-context-metadata.schema";

export function getAppDataDirectory() {
  if (process.env.NULLTRACE_APP_DATA_DIR) {
    return process.env.NULLTRACE_APP_DATA_DIR;
  }

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

function createSessionFindingsTable() {
  sessionDatabase.exec(`
    CREATE TABLE IF NOT EXISTS session_findings (
      id TEXT PRIMARY KEY,
      session_id TEXT NOT NULL,
      tool_run_artifact_id TEXT NOT NULL,
      source_tool TEXT NOT NULL,
      kind TEXT NOT NULL,
      severity TEXT NOT NULL,
      title TEXT NOT NULL,
      summary TEXT NOT NULL,
      target TEXT NOT NULL,
      fingerprint TEXT NOT NULL,
      payload_json TEXT NOT NULL,
      first_seen_at TEXT NOT NULL,
      last_seen_at TEXT NOT NULL,
      created_at TEXT NOT NULL,
      FOREIGN KEY (session_id) REFERENCES sessions(id) ON DELETE CASCADE,
      FOREIGN KEY (tool_run_artifact_id) REFERENCES tool_run_artifacts(id) ON DELETE CASCADE
    );

    CREATE UNIQUE INDEX IF NOT EXISTS idx_session_findings_session_fingerprint
      ON session_findings(session_id, fingerprint);
    CREATE INDEX IF NOT EXISTS idx_session_findings_session_last_seen
      ON session_findings(session_id, last_seen_at DESC);
  `);
}

function createFindingReviewsTable() {
  sessionDatabase.exec(`
    CREATE TABLE IF NOT EXISTS finding_reviews (
      finding_id TEXT PRIMARY KEY,
      review_status TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      FOREIGN KEY (finding_id) REFERENCES session_findings(id) ON DELETE CASCADE
    );
  `);
}

function createConversationAttachmentsTable() {
  sessionDatabase.exec(`
    CREATE TABLE IF NOT EXISTS conversation_attachments (
      session_id TEXT NOT NULL,
      opencode_conversation_id TEXT PRIMARY KEY,
      is_default INTEGER NOT NULL CHECK (is_default IN (0, 1)),
      archived_at TEXT,
      created_at TEXT NOT NULL,
      FOREIGN KEY (session_id) REFERENCES sessions(id) ON DELETE CASCADE
    );
    CREATE INDEX IF NOT EXISTS idx_conversation_attachments_session_active
      ON conversation_attachments(session_id, archived_at, created_at);
    CREATE UNIQUE INDEX IF NOT EXISTS idx_conversation_attachments_active_default
      ON conversation_attachments(session_id)
      WHERE is_default = 1 AND archived_at IS NULL;
  `);
}

function createTargetSitemapTables() {
  sessionDatabase.exec(`
    CREATE TABLE IF NOT EXISTS target_sitemap_entries (
      id TEXT PRIMARY KEY,
      target_id TEXT NOT NULL,
      normalized_url TEXT NOT NULL,
      path TEXT NOT NULL,
      method TEXT,
      http_status INTEGER,
      source TEXT NOT NULL,
      depth INTEGER NOT NULL,
      first_seen_at TEXT NOT NULL,
      last_seen_at TEXT NOT NULL,
      created_at TEXT NOT NULL,
      FOREIGN KEY (target_id) REFERENCES targets(id) ON DELETE CASCADE
    );
  `);

  const entryColumns = sessionDatabase
    .query<{ name: string }, []>("PRAGMA table_info(target_sitemap_entries)")
    .all();
  if (!entryColumns.some((column) => column.name === "provenance")) {
    sessionDatabase.exec(
      "ALTER TABLE target_sitemap_entries ADD COLUMN provenance TEXT NOT NULL DEFAULT 'public'",
    );
  }

  sessionDatabase.exec(`
    CREATE UNIQUE INDEX IF NOT EXISTS idx_target_sitemap_entries_target_url_method
      ON target_sitemap_entries(target_id, normalized_url, method)
      WHERE method IS NOT NULL;
    CREATE UNIQUE INDEX IF NOT EXISTS idx_target_sitemap_entries_target_url_without_method
      ON target_sitemap_entries(target_id, normalized_url)
      WHERE method IS NULL;
    CREATE INDEX IF NOT EXISTS idx_target_sitemap_entries_target_depth
      ON target_sitemap_entries(target_id, depth, path);
  `);

  sessionDatabase.exec(`
    CREATE TABLE IF NOT EXISTS target_sitemap_crawl_statuses (
      target_id TEXT PRIMARY KEY,
      status TEXT NOT NULL,
      started_at TEXT,
      completed_at TEXT,
      failed_at TEXT,
      error_message TEXT,
      updated_at TEXT NOT NULL,
      FOREIGN KEY (target_id) REFERENCES targets(id) ON DELETE CASCADE
    );
  `);

  sessionDatabase.exec(`
    CREATE TABLE IF NOT EXISTS authenticated_sitemap_access_observations (
      session_id TEXT NOT NULL,
      target_id TEXT NOT NULL,
      entry_id TEXT NOT NULL,
      http_status INTEGER NOT NULL,
      observed_at TEXT NOT NULL,
      PRIMARY KEY (session_id, entry_id),
      FOREIGN KEY (session_id) REFERENCES sessions(id) ON DELETE CASCADE,
      FOREIGN KEY (target_id) REFERENCES targets(id) ON DELETE CASCADE,
      FOREIGN KEY (entry_id) REFERENCES target_sitemap_entries(id) ON DELETE CASCADE
    );
    CREATE INDEX IF NOT EXISTS idx_authenticated_sitemap_access_session
      ON authenticated_sitemap_access_observations(session_id, observed_at);

    CREATE TABLE IF NOT EXISTS authenticated_sitemap_crawl_statuses (
      session_id TEXT PRIMARY KEY,
      target_id TEXT NOT NULL,
      status TEXT NOT NULL,
      started_at TEXT,
      completed_at TEXT,
      paused_at TEXT,
      failed_at TEXT,
      error_message TEXT,
      updated_at TEXT NOT NULL,
      FOREIGN KEY (session_id) REFERENCES sessions(id) ON DELETE CASCADE,
      FOREIGN KEY (target_id) REFERENCES targets(id) ON DELETE CASCADE
    );

    CREATE TABLE IF NOT EXISTS sitemap_crawl_checkpoints (
      crawler_type TEXT NOT NULL,
      owner_id TEXT NOT NULL,
      target_id TEXT NOT NULL,
      root_url TEXT NOT NULL,
      frontier_json TEXT NOT NULL,
      visited_urls_json TEXT NOT NULL,
      failures_json TEXT NOT NULL,
      pages_fetched INTEGER NOT NULL,
      entries_discovered INTEGER NOT NULL,
      updated_at TEXT NOT NULL,
      PRIMARY KEY (crawler_type, owner_id),
      FOREIGN KEY (target_id) REFERENCES targets(id) ON DELETE CASCADE
    );
  `);

}

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

  CREATE TABLE IF NOT EXISTS tool_run_artifacts (
    id TEXT PRIMARY KEY,
    tool_run_id TEXT NOT NULL,
    artifact_type TEXT NOT NULL,
    label TEXT NOT NULL,
    source TEXT NOT NULL,
    payload_json TEXT NOT NULL,
    created_at TEXT NOT NULL,
    FOREIGN KEY (tool_run_id) REFERENCES tool_runs(id) ON DELETE CASCADE
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
  CREATE INDEX IF NOT EXISTS idx_tool_run_artifacts_tool_run_id
    ON tool_run_artifacts(tool_run_id);
`);

const sessionFindingsTable = sessionDatabase
  .query<{ name: string }, []>(
    `SELECT name
     FROM sqlite_master
     WHERE type = 'table'
       AND name = 'session_findings'`,
  )
  .get();

if (sessionFindingsTable) {
  const sessionFindingColumns = sessionDatabase
    .query<{ name: string }, []>("PRAGMA table_info(session_findings)")
    .all()
    .map((column) => column.name);

  const hasCurrentSessionFindingsSchema = [
    "tool_run_artifact_id",
    "summary",
    "target",
    "fingerprint",
    "first_seen_at",
    "last_seen_at",
  ].every((columnName) => sessionFindingColumns.includes(columnName));

  if (!hasCurrentSessionFindingsSchema) {
    sessionDatabase.exec("DROP TABLE session_findings;");
  }
}

createSessionFindingsTable();
createFindingReviewsTable();
createConversationAttachmentsTable();
createActionDraftsTable(sessionDatabase);
createAuthenticationContextMetadataTable(sessionDatabase);
createTargetSitemapTables();
