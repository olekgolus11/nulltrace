import { Database } from "bun:sqlite";
import { describe, expect, it } from "bun:test";
import { FindingRepository } from "../finding.repository";

function createTestDatabase() {
  const database = new Database(":memory:", {
    create: true,
    strict: true,
  });

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
  `);

  database
    .query("INSERT INTO sessions (id, last_activity_at) VALUES (?1, ?2)")
    .run("session-1", "2026-05-10T10:00:00.000Z");

  return database;
}

describe("FindingRepository", () => {
  it("inserts normalized session finding candidates", () => {
    const repository = new FindingRepository(createTestDatabase());

    const records = repository.upsertCandidates([
      {
        sessionId: "session-1",
        toolRunArtifactId: "artifact-1",
        candidate: {
          sourceTool: "nmap",
          kind: "nmap.open_port",
          severity: "unexpected",
          title: "Open TCP port 443",
          summary: "scanme.nmap.org exposes 443/tcp.",
          target: "scanme.nmap.org:443",
          dedupeKeyParts: ["scanme.nmap.org", "443/tcp"],
          payload: {
            artifactItemPath: "$.hosts[0].ports[0]",
          },
        },
      },
    ]);

    expect(records).toHaveLength(1);
    expect(records[0]).toMatchObject({
      sessionId: "session-1",
      toolRunArtifactId: "artifact-1",
      sourceTool: "nmap",
      kind: "nmap.open_port",
      severity: "info",
      title: "Open TCP port 443",
      summary: "scanme.nmap.org exposes 443/tcp.",
      target: "scanme.nmap.org:443",
      payload: {
        artifactItemPath: "$.hosts[0].ports[0]",
      },
    });
    expect(records[0].fingerprint).toHaveLength(64);
    expect(records[0].fingerprint).not.toContain("scanme.nmap.org");
  });

  it("upserts duplicate candidates within a session by fingerprint", () => {
    const database = createTestDatabase();
    const repository = new FindingRepository(database);

    const [first] = repository.upsertCandidates([
      {
        sessionId: "session-1",
        toolRunArtifactId: "artifact-1",
        candidate: {
          sourceTool: "nuclei",
          kind: "nuclei.cve",
          severity: "high",
          title: "Initial template title",
          summary: "Initial summary.",
          target: "https://example.com/admin",
          dedupeKeyParts: ["template-id", "https://example.com/admin"],
          payload: {
            artifactFindingIndex: 0,
          },
        },
      },
    ]);

    const [second] = repository.upsertCandidates([
      {
        sessionId: "session-1",
        toolRunArtifactId: "artifact-2",
        candidate: {
          sourceTool: "nuclei",
          kind: "nuclei.cve",
          severity: "low",
          title: "Latest template title",
          summary: "Latest summary.",
          target: "https://example.com/admin",
          dedupeKeyParts: ["template-id", "https://example.com/admin"],
          payload: {
            artifactFindingIndex: 1,
          },
        },
      },
    ]);

    const rowCount = database
      .query<{ count: number }, []>(
        "SELECT COUNT(*) AS count FROM session_findings",
      )
      .get();

    expect(rowCount?.count).toBe(1);
    expect(second.id).toBe(first.id);
    expect(second.firstSeenAt).toBe(first.firstSeenAt);
    expect(second).toMatchObject({
      toolRunArtifactId: "artifact-2",
      severity: "high",
      title: "Latest template title",
      summary: "Latest summary.",
      payload: {
        artifactFindingIndex: 1,
      },
    });
    expect(second.lastSeenAt >= first.lastSeenAt).toBe(true);
  });

  it("deduplicates only within the same session", () => {
    const database = createTestDatabase();
    database
      .query("INSERT INTO sessions (id, last_activity_at) VALUES (?1, ?2)")
      .run("session-2", "2026-05-10T10:00:00.000Z");
    const repository = new FindingRepository(database);
    const candidate = {
      sourceTool: "nmap",
      kind: "nmap.open_port",
      severity: "info",
      title: "Open TCP port 443",
      summary: "scanme.nmap.org exposes 443/tcp.",
      target: "scanme.nmap.org:443",
      dedupeKeyParts: ["scanme.nmap.org", "443/tcp"],
      payload: {
        artifactItemPath: "$.hosts[0].ports[0]",
      },
    };

    repository.upsertCandidates([
      {
        sessionId: "session-1",
        toolRunArtifactId: "artifact-1",
        candidate,
      },
      {
        sessionId: "session-2",
        toolRunArtifactId: "artifact-2",
        candidate,
      },
    ]);

    const rowCount = database
      .query<{ count: number }, []>(
        "SELECT COUNT(*) AS count FROM session_findings",
      )
      .get();

    expect(rowCount?.count).toBe(2);
  });
});
