import { describe, expect, test } from "bun:test";
import { Database } from "bun:sqlite";
import { createAuthenticationContextMetadataTable } from "../authentication-context-metadata.schema";
import { AuthenticationContextStateRepository } from "../authentication-context-state.repository";

function createRepository() {
  const database = new Database(":memory:", { create: true, strict: true });
  database.exec("CREATE TABLE sessions (id TEXT PRIMARY KEY);");
  database.exec("INSERT INTO sessions (id) VALUES ('session-1');");
  createAuthenticationContextMetadataTable(database);
  return { database, repository: new AuthenticationContextStateRepository(database) };
}

describe("AuthenticationContextStateRepository", () => {
  test("increments durable per-session generations and fails closed on unresolved writers", () => {
    const { database, repository } = createRepository();
    const firstGeneration = repository.beginSave("session-1");
    expect(firstGeneration).toBe(1);
    expect(repository.find("session-1")).toMatchObject({ status: "saving", generation: 1 });

    const clearGeneration = repository.beginClear("session-1");
    expect(clearGeneration).toBe(2);
    expect(repository.confirmClear("session-1", clearGeneration)).toBe(false);
    expect(repository.hasUnsettledSecretWrites("session-1", clearGeneration)).toBe(true);

    repository.markSecretKeyPending("session-1", firstGeneration);
    expect(repository.confirmClear("session-1", clearGeneration)).toBe(false);
    repository.markSecretKeyDeleted("session-1", 0);
    repository.markSecretKeyDeleted("session-1", firstGeneration);
    expect(repository.confirmClear("session-1", clearGeneration)).toBe(true);
    expect(repository.find("session-1")).toMatchObject({ status: "cleared", generation: 2 });

    const reopened = new AuthenticationContextStateRepository(database);
    expect(reopened.find("session-1")).toMatchObject({ status: "cleared", generation: 2 });
  });

  test("rejects malformed durable state rather than treating it as an absent legacy record", () => {
    const { database, repository } = createRepository();
    repository.beginSave("session-1");
    database.exec("PRAGMA ignore_check_constraints = ON;");
    database.exec("UPDATE session_authentication_context_state SET storage_mode = 'unknown';");

    expect(() => repository.find("session-1")).toThrow("state is invalid");
  });

  test("rejects unsafe generation overflow before changing state", () => {
    const { database, repository } = createRepository();
    repository.beginSave("session-1");
    database
      .query("UPDATE session_authentication_context_state SET generation = ?1 WHERE session_id = 'session-1'")
      .run(Number.MAX_SAFE_INTEGER);

    expect(() => repository.beginClear("session-1")).toThrow("generation limit");
    expect(repository.find("session-1")?.generation).toBe(Number.MAX_SAFE_INTEGER);
  });
});
