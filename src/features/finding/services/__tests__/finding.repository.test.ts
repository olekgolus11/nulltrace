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

    CREATE TABLE finding_reviews (
      finding_id TEXT PRIMARY KEY,
      review_status TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );
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
      reviewStatus: "needs_review",
      reviewUpdatedAt: null,
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
      .query<{ count: number }, []>("SELECT COUNT(*) AS count FROM session_findings")
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
      .query<{ count: number }, []>("SELECT COUNT(*) AS count FROM session_findings")
      .get();

    expect(rowCount?.count).toBe(2);
  });

  it("lists session findings by severity and last seen recency", () => {
    const database = createTestDatabase();
    const repository = new FindingRepository(database);

    repository.upsertCandidates([
      {
        sessionId: "session-1",
        toolRunArtifactId: "artifact-1",
        candidate: {
          sourceTool: "nmap",
          kind: "nmap.open_port",
          severity: "info",
          title: "Open TCP port 443",
          summary: "scanme.nmap.org exposes 443/tcp.",
          target: "scanme.nmap.org:443",
          dedupeKeyParts: ["scanme.nmap.org", "443/tcp"],
          payload: {},
        },
      },
      {
        sessionId: "session-1",
        toolRunArtifactId: "artifact-2",
        candidate: {
          sourceTool: "nuclei",
          kind: "nuclei.http",
          severity: "high",
          title: "Older high finding",
          summary: "High severity finding.",
          target: "https://example.com/old",
          dedupeKeyParts: ["older-high"],
          payload: {},
        },
      },
      {
        sessionId: "session-1",
        toolRunArtifactId: "artifact-3",
        candidate: {
          sourceTool: "nuclei",
          kind: "nuclei.cve",
          severity: "critical",
          title: "Critical finding",
          summary: "Critical severity finding.",
          target: "https://example.com/critical",
          dedupeKeyParts: ["critical"],
          payload: {},
        },
      },
    ]);

    repository.upsertCandidates([
      {
        sessionId: "session-1",
        toolRunArtifactId: "artifact-4",
        candidate: {
          sourceTool: "nuclei",
          kind: "nuclei.http",
          severity: "high",
          title: "Newest high finding",
          summary: "Newer high severity finding.",
          target: "https://example.com/new",
          dedupeKeyParts: ["newest-high"],
          payload: {},
        },
      },
    ]);

    database
      .query(
        `UPDATE session_findings
         SET last_seen_at = ?2
         WHERE title = ?1`,
      )
      .run("Older high finding", "2026-05-10T10:00:00.000Z");
    database
      .query(
        `UPDATE session_findings
         SET last_seen_at = ?2
         WHERE title = ?1`,
      )
      .run("Newest high finding", "2026-05-10T10:01:00.000Z");

    const findings = repository.listBySessionId("session-1");

    expect(findings.map((finding) => finding.title)).toEqual([
      "Critical finding",
      "Newest high finding",
      "Older high finding",
      "Open TCP port 443",
    ]);
  });

  it("uses needs_review when no explicit finding review exists", () => {
    const repository = new FindingRepository(createTestDatabase());

    repository.upsertCandidates([
      {
        sessionId: "session-1",
        toolRunArtifactId: "artifact-1",
        candidate: {
          sourceTool: "nmap",
          kind: "nmap.open_port",
          severity: "info",
          title: "Open TCP port 443",
          summary: "scanme.nmap.org exposes 443/tcp.",
          target: "scanme.nmap.org:443",
          dedupeKeyParts: ["scanme.nmap.org", "443/tcp"],
          payload: {},
        },
      },
    ]);

    const [finding] = repository.listBySessionId("session-1");

    expect(finding).toMatchObject({
      reviewStatus: "needs_review",
      reviewUpdatedAt: null,
    });
  });

  it("creates and updates finding review status", () => {
    const repository = new FindingRepository(createTestDatabase());
    const [finding] = repository.upsertCandidates([
      {
        sessionId: "session-1",
        toolRunArtifactId: "artifact-1",
        candidate: {
          sourceTool: "nuclei",
          kind: "nuclei.http",
          severity: "high",
          title: "Exposed admin panel",
          summary: "Nuclei reported an exposed admin panel.",
          target: "https://example.com/admin",
          dedupeKeyParts: ["exposed-admin", "https://example.com/admin"],
          payload: {},
        },
      },
    ]);

    const confirmed = repository.setReviewStatus({
      findingId: finding.id,
      reviewStatus: "confirmed",
    });
    const dismissed = repository.setReviewStatus({
      findingId: finding.id,
      reviewStatus: "dismissed",
    });

    expect(confirmed).toMatchObject({
      id: finding.id,
      reviewStatus: "confirmed",
    });
    expect(confirmed?.reviewUpdatedAt).toBeString();
    expect(dismissed).toMatchObject({
      id: finding.id,
      reviewStatus: "dismissed",
    });
    expect(dismissed?.reviewUpdatedAt).toBeString();
  });

  it("persists explicit needs_review after interaction", () => {
    const database = createTestDatabase();
    const repository = new FindingRepository(database);
    const [finding] = repository.upsertCandidates([
      {
        sessionId: "session-1",
        toolRunArtifactId: "artifact-1",
        candidate: {
          sourceTool: "nmap",
          kind: "nmap.script_signal",
          severity: "info",
          title: "Nmap script reported output",
          summary: "Nmap script reported output on scanme.nmap.org.",
          target: "scanme.nmap.org",
          dedupeKeyParts: ["scanme.nmap.org", "http-title"],
          payload: {},
        },
      },
    ]);

    const reviewed = repository.setReviewStatus({
      findingId: finding.id,
      reviewStatus: "needs_review",
    });
    const rowCount = database
      .query<{ count: number }, []>("SELECT COUNT(*) AS count FROM finding_reviews")
      .get();

    expect(rowCount?.count).toBe(1);
    expect(reviewed).toMatchObject({
      reviewStatus: "needs_review",
    });
    expect(reviewed?.reviewUpdatedAt).toBeString();
  });

  it("preserves finding review status when scanner upserts the finding", () => {
    const repository = new FindingRepository(createTestDatabase());
    const [first] = repository.upsertCandidates([
      {
        sessionId: "session-1",
        toolRunArtifactId: "artifact-1",
        candidate: {
          sourceTool: "nuclei",
          kind: "nuclei.cve",
          severity: "medium",
          title: "Initial title",
          summary: "Initial summary.",
          target: "https://example.com/login",
          dedupeKeyParts: ["template-id", "https://example.com/login"],
          payload: {
            artifactFindingIndex: 0,
          },
        },
      },
    ]);

    repository.setReviewStatus({
      findingId: first.id,
      reviewStatus: "confirmed",
    });

    const [second] = repository.upsertCandidates([
      {
        sessionId: "session-1",
        toolRunArtifactId: "artifact-2",
        candidate: {
          sourceTool: "nuclei",
          kind: "nuclei.cve",
          severity: "critical",
          title: "Updated title",
          summary: "Updated summary.",
          target: "https://example.com/login",
          dedupeKeyParts: ["template-id", "https://example.com/login"],
          payload: {
            artifactFindingIndex: 1,
          },
        },
      },
    ]);
    const [listed] = repository.listBySessionId("session-1");

    expect(second).toMatchObject({
      id: first.id,
      severity: "critical",
      title: "Updated title",
      reviewStatus: "confirmed",
    });
    expect(listed).toMatchObject({
      id: first.id,
      reviewStatus: "confirmed",
    });
  });

  it("updates assistant finding content without changing operator review status", () => {
    const repository = new FindingRepository(createTestDatabase());
    const [finding] = repository.upsertCandidates([
      {
        sessionId: "session-1",
        toolRunArtifactId: "artifact-1",
        candidate: {
          sourceTool: "assistant",
          kind: "assistant.authorization.bypass",
          severity: "high",
          title: "Initial title",
          summary: "Initial summary.",
          target: "https://example.com/admin",
          dedupeKeyParts: ["run-1", "assistant.authorization.bypass", "https://example.com/admin"],
          payload: {
            assistantReported: true,
            evidence: "Initial evidence.",
            recommendation: null,
            sourceTool: "curl",
            sourceToolRunId: "run-1",
          },
        },
      },
    ]);
    repository.setReviewStatus({ findingId: finding.id, reviewStatus: "confirmed" });

    const updated = repository.updateAssistantFinding({
      sessionId: "session-1",
      findingId: finding.id,
      severity: "critical",
      title: "Updated title",
      summary: "Updated summary.",
      target: "https://example.com/admin/users",
      fingerprint: "updated-fingerprint",
      payload: {
        assistantReported: true,
        evidence: "Updated evidence.",
        recommendation: "Enforce authorization.",
        sourceTool: "curl",
        sourceToolRunId: "run-1",
      },
    });

    expect(updated).toMatchObject({
      id: finding.id,
      severity: "critical",
      title: "Updated title",
      fingerprint: "updated-fingerprint",
      reviewStatus: "confirmed",
      reviewUpdatedAt: expect.any(String),
      payload: {
        evidence: "Updated evidence.",
        recommendation: "Enforce authorization.",
      },
    });
  });

  it("does not update scanner findings through the assistant-only repository method", () => {
    const repository = new FindingRepository(createTestDatabase());
    const [finding] = repository.upsertCandidates([
      {
        sessionId: "session-1",
        toolRunArtifactId: "artifact-1",
        candidate: {
          sourceTool: "nuclei",
          kind: "nuclei.http",
          severity: "medium",
          title: "Scanner finding",
          summary: "Scanner summary.",
          target: "https://example.com",
          dedupeKeyParts: ["scanner-finding"],
          payload: {},
        },
      },
    ]);

    const updated = repository.updateAssistantFinding({
      sessionId: "session-1",
      findingId: finding.id,
      severity: "critical",
      title: "Overwritten",
      summary: "Overwritten.",
      target: "https://example.com/admin",
      fingerprint: "overwritten-fingerprint",
      payload: {
        assistantReported: true,
        evidence: "Evidence.",
        recommendation: null,
        sourceTool: "curl",
        sourceToolRunId: "run-1",
      },
    });

    expect(updated).toBeNull();
    expect(repository.listBySessionId("session-1")[0]?.title).toBe("Scanner finding");
  });
});
