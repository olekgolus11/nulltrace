import { Database } from "bun:sqlite";
import { describe, expect, test } from "bun:test";
import { AuthenticationContextMetadataRepository } from "../authentication-context-metadata.repository";
import { createAuthenticationContextMetadataTable } from "../authentication-context-metadata.schema";

function createDatabase() {
  const database = new Database(":memory:", {
    create: true,
    strict: true,
  });
  database.exec(`
    CREATE TABLE sessions (
      id TEXT PRIMARY KEY
    );
    INSERT INTO sessions (id) VALUES ('session-1');

    CREATE TABLE session_authentication_context_metadata (
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
  createAuthenticationContextMetadataTable(database);
  return database;
}

const verifiedMetadata = {
  origin: "https://example.com",
  cookieCount: 1,
  headerNames: ["Authorization"],
  storageMode: "secure" as const,
  importSource: "curl" as const,
  updatedAt: "2026-07-15T10:00:00.000Z",
  authCheck: {
    status: "verified" as const,
    verificationUrl: "https://example.com/account",
    checkedAt: "2026-07-15T10:01:00.000Z",
    acknowledgedAt: null,
    isProceedAllowed: true,
    summary: "Authenticated behavior differs from public behavior.",
    signals: null,
  },
};

describe("AuthenticationContextMetadataRepository", () => {
  test("shares non-secret auth posture only within the active app runtime", () => {
    const database = createDatabase();
    const appWriter = new AuthenticationContextMetadataRepository(database, "runtime-1");
    const chatReader = new AuthenticationContextMetadataRepository(database, "runtime-1");
    const restartedApp = new AuthenticationContextMetadataRepository(database, "runtime-2");

    appWriter.upsert("session-1", verifiedMetadata);

    expect(chatReader.findBySessionId("session-1")).toEqual(verifiedMetadata);
    expect(restartedApp.findBySessionId("session-1")).toBeNull();

    const row = database
      .query<{ authCheckJson: string }, []>(
        `SELECT auth_check_json AS authCheckJson
         FROM session_authentication_context_metadata`,
      )
      .get();
    expect(row?.authCheckJson).not.toContain("Bearer");
    expect(row?.authCheckJson).not.toContain("cookie");
  });

  test("migrates legacy metadata rows with empty browser storage counts", () => {
    const database = createDatabase();
    const repository = new AuthenticationContextMetadataRepository(database, "runtime-1");

    repository.upsert("session-1", verifiedMetadata);

    expect(repository.findBySessionId("session-1")).toEqual(verifiedMetadata);
    expect(
      database
        .query<
          { localStorageEntryCount: number; sessionStorageEntryCount: number },
          []
        >(
          `SELECT
            local_storage_entry_count AS localStorageEntryCount,
            session_storage_entry_count AS sessionStorageEntryCount
          FROM session_authentication_context_metadata`,
        )
        .get(),
    ).toEqual({
      localStorageEntryCount: 0,
      sessionStorageEntryCount: 0,
    });
  });
});
