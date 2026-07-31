import { Database } from "bun:sqlite";
import { describe, expect, it } from "bun:test";
import { ToolRunArtifactRecord } from "../../../../session/model/session.repository.types";
import { createFindingFingerprint } from "../../finding-fingerprint";
import { FindingRepository } from "../../finding.repository";
import { sqlmapFindingMapper } from "../sqlmap-finding.mapper";

function artifact(payload: unknown): ToolRunArtifactRecord {
  return {
    id: "artifact-1",
    toolRunId: "run-1",
    artifactType: "sqlmap_verification",
    label: "Targeted sqlmap verification",
    source: "sqlmap.normalized.json",
    payload,
    createdAt: "2026-07-31T10:00:00.000Z",
  };
}

function positivePayload() {
  return {
    runContext: {
      endpoint: "http://127.0.0.1:3000/products?id=1",
      method: "GET",
      parameter: "id",
      status: "success",
      exitCode: 0,
    },
    outcome: "positive",
    observations: [
      {
        endpoint: "http://127.0.0.1:3000/products?id=1",
        method: "GET",
        parameter: "id",
        place: "GET",
        databaseManagementSystem: "MySQL",
        techniques: [
          {
            type: "error-based",
            title: "MySQL error-based",
          },
        ],
      },
    ],
    parseWarning: null,
  };
}

describe("sqlmapFindingMapper", () => {
  it("maps a positive observation with a stable targeted fingerprint", () => {
    const [candidate] = sqlmapFindingMapper.mapArtifact(artifact(positivePayload()));

    expect(candidate).toMatchObject({
      sourceTool: "sqlmap",
      kind: "sqlmap.sql_injection",
      severity: "high",
      title: "SQL injection verified in id",
      target: "http://127.0.0.1:3000/products?id=1",
      dedupeKeyParts: ["http://127.0.0.1:3000/products?id=1", "GET", "id"],
      payload: {
        artifactObservationIndex: 0,
        artifactItemPath: "$.observations[0]",
        method: "GET",
        parameter: "id",
        databaseManagementSystem: "MySQL",
        techniqueTypes: ["error-based"],
      },
    });
    expect(
      createFindingFingerprint(
        candidate!.sourceTool,
        candidate!.kind,
        candidate!.dedupeKeyParts,
      ),
    ).toBe("a498caa19b073cba9bb0587e9af5ae242f8615718f246286e2a73dc5d9091a29");
  });

  it("does not create Findings from negative, inconclusive, or malformed artifacts", () => {
    expect(
      sqlmapFindingMapper.mapArtifact(
        artifact({ ...positivePayload(), outcome: "negative", observations: [] }),
      ),
    ).toEqual([]);
    expect(
      sqlmapFindingMapper.mapArtifact(
        artifact({ ...positivePayload(), outcome: "inconclusive", observations: [] }),
      ),
    ).toEqual([]);
    expect(sqlmapFindingMapper.mapArtifact(artifact({ outcome: "positive" }))).toEqual([]);
  });

  it("creates an effective needs_review Finding without a Finding Review row", () => {
    const database = createFindingDatabase();
    const repository = new FindingRepository(database);
    const [candidate] = sqlmapFindingMapper.mapArtifact(artifact(positivePayload()));

    repository.upsertCandidates([
      {
        sessionId: "session-1",
        toolRunArtifactId: "artifact-1",
        candidate: candidate!,
      },
    ]);

    expect(repository.listBySessionId("session-1")[0]).toMatchObject({
      sourceTool: "sqlmap",
      reviewStatus: "needs_review",
      reviewUpdatedAt: null,
    });
    expect(
      database
        .query<{ count: number }, []>("SELECT COUNT(*) AS count FROM finding_reviews")
        .get()?.count,
    ).toBe(0);
  });
});

function createFindingDatabase() {
  const database = new Database(":memory:", { create: true, strict: true });
  database.exec(`
    CREATE TABLE sessions (
      id TEXT PRIMARY KEY,
      last_activity_at TEXT NOT NULL
    );
    CREATE TABLE session_findings (
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
      created_at TEXT NOT NULL
    );
    CREATE UNIQUE INDEX idx_session_findings_session_fingerprint
      ON session_findings(session_id, fingerprint);
    CREATE TABLE finding_reviews (
      finding_id TEXT PRIMARY KEY,
      review_status TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );
  `);
  database
    .query("INSERT INTO sessions (id, last_activity_at) VALUES (?1, ?2)")
    .run("session-1", "2026-07-31T10:00:00.000Z");
  return database;
}
