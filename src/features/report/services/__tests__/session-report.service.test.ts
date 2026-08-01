import { describe, expect, it } from "bun:test";
import { SessionFindingRecord } from "../../../finding/model/finding.types";
import {
  SessionReportFileWriter,
  SessionReportFindingRepository,
  SessionReportSessionRepository,
} from "../../model/session-report.types";
import {
  ToolRunArtifactRecord,
  ToolRunSummary,
} from "../../../session/model/session.repository.types";
import { findingRepository } from "../../../finding/services/finding.repository";
import { sessionRepository } from "../../../session/services/session.repository";
import { SessionReportService } from "../session-report.service";

const session = {
  id: "session-1",
  targetId: "target-1",
  normalizedUrl: "https://example.test/",
  displayUrl: "https://example.test",
  createdAt: "2026-07-01T10:00:00.000Z",
  lastActivityAt: "2026-07-01T11:00:00.000Z",
};

function createFinding(
  id: string,
  reviewStatus: SessionFindingRecord["reviewStatus"],
): SessionFindingRecord {
  return {
    id,
    sessionId: session.id,
    toolRunArtifactId: `artifact-${id}`,
    sourceTool: "nuclei",
    kind: "nuclei.http",
    severity: "high",
    title: `Finding ${id}`,
    summary: `Summary ${id}`,
    target: "https://example.test/login",
    fingerprint: `fingerprint-${id}`,
    payload: {
      artifactItemPath: "$.findings[0]",
      templateId: `template-${id}`,
    },
    reviewStatus,
    reviewUpdatedAt: "2026-07-01T10:30:00.000Z",
    firstSeenAt: "2026-07-01T10:05:00.000Z",
    lastSeenAt: "2026-07-01T10:10:00.000Z",
    createdAt: "2026-07-01T10:05:00.000Z",
  };
}

class FakeSessionRepository implements SessionReportSessionRepository {
  constructor(
    private readonly toolRuns: ToolRunSummary[] = [],
    private readonly artifacts: ToolRunArtifactRecord[] = [],
    private readonly sessionFact = session,
  ) {}

  getSessionById() {
    return this.sessionFact;
  }

  listToolRunsBySessionId() {
    return this.toolRuns;
  }

  findToolRunArtifactByIdForSession(_sessionId: string, artifactId: string) {
    return this.artifacts.find((artifact) => artifact.id === artifactId) ?? null;
  }
}

class FakeFindingRepository implements SessionReportFindingRepository {
  constructor(private readonly findings: SessionFindingRecord[]) {}

  listBySessionId() {
    return this.findings;
  }
}

class FakeFileWriter implements SessionReportFileWriter {
  writes: Array<{ outputPath: string; markdown: string }> = [];

  async write(outputPath: string, markdown: string) {
    this.writes.push({ outputPath, markdown });
  }
}

class FailingFileWriter implements SessionReportFileWriter {
  async write() {
    throw new Error("EACCES: permission denied");
  }
}

describe("SessionReportService", () => {
  it("selects confirmed Findings by default and requires opt-in for other review statuses", () => {
    const service = new SessionReportService(
      new FakeSessionRepository(),
      new FakeFindingRepository([
        createFinding("confirmed", "confirmed"),
        createFinding("needs-review", "needs_review"),
        createFinding("dismissed", "dismissed"),
      ]),
      new FakeFileWriter(),
    );

    const draft = service.createDraft(session.id);

    expect(draft?.selectedFindingIds).toEqual(["confirmed"]);
    expect(draft?.findings.map((finding) => finding.reviewStatus)).toEqual([
      "confirmed",
      "needs_review",
      "dismissed",
    ]);
  });

  it("exports stable Markdown ordered by persisted run and Finding facts", async () => {
    const findings = [
      createFinding("later-title", "confirmed"),
      {
        ...createFinding("critical", "needs_review"),
        severity: "critical" as const,
        title: "Critical first",
        toolRunArtifactId: "artifact-critical",
      },
    ];
    const toolRuns: ToolRunSummary[] = [
      {
        id: "run-later",
        toolName: "nuclei",
        command: "nuclei -u https://example.test",
        commandSource: "generated",
        status: "success",
        startedAt: "2026-07-01T10:20:00.000Z",
        endedAt: "2026-07-01T10:21:00.000Z",
        exitCode: 0,
      },
      {
        id: "run-earlier",
        toolName: "nmap",
        command: "nmap example.test",
        commandSource: "generated",
        status: "success",
        startedAt: "2026-07-01T10:00:00.000Z",
        endedAt: "2026-07-01T10:01:00.000Z",
        exitCode: 0,
      },
    ];
    const artifacts: ToolRunArtifactRecord[] = [
      {
        id: "artifact-critical",
        toolRunId: "run-earlier",
        artifactType: "nmap_scan",
        label: "Nmap scan",
        source: "artifacts/nmap.xml",
        payload: {},
        createdAt: "2026-07-01T10:01:00.000Z",
      },
      {
        id: "artifact-later-title",
        toolRunId: "run-later",
        artifactType: "nuclei_findings",
        label: "Nuclei findings",
        source: "artifacts/nuclei.jsonl",
        payload: {},
        createdAt: "2026-07-01T10:21:00.000Z",
      },
    ];
    const writer = new FakeFileWriter();
    const service = new SessionReportService(
      new FakeSessionRepository(toolRuns, artifacts),
      new FakeFindingRepository(findings),
      writer,
    );

    const result = await service.exportMarkdown({
      sessionId: session.id,
      selectedFindingIds: ["later-title", "critical"],
      outputPath: "/tmp/session-report.md",
    });

    expect(result).toEqual({
      status: "success",
      outputPath: "/tmp/session-report.md",
      findingCount: 2,
    });
    expect(writer.writes).toHaveLength(1);
    const markdown = writer.writes[0]!.markdown;
    expect(markdown).toContain("# NullTrace Session Findings Report");
    expect(markdown).toContain("- Session ID: `session-1`");
    expect(markdown).toContain("## Tools Used\n\n- `nmap`\n- `nuclei`");
    expect(markdown.indexOf("### `run-earlier` — nmap")).toBeLessThan(
      markdown.indexOf("### `run-later` — nuclei"),
    );
    expect(markdown.indexOf("### 1. [CRITICAL] Critical first")).toBeLessThan(
      markdown.indexOf("### 2. [HIGH] Finding later-title"),
    );
    expect(markdown).toContain("- Tool Run ID: `run-earlier`");
    expect(markdown).toContain("- Artifact ID: `artifact-critical`");
  });

  it("includes bounded Source Context without commands, secret paths, or protected payload data", async () => {
    const credential = "Bearer credential-must-not-export";
    const secretPath = "/private/tmp/nulltrace-secret-credentials.yaml";
    const protectedEvidence = "protected-response-body-must-not-export";
    const finding = {
      ...createFinding("traceable", "confirmed"),
      payload: {
        artifactFindingIndex: 4,
        artifactItemPath: "$.findings[4]",
        templateId: "exposed-panel",
        matchedAt: "https://example.test/api/secrets/list",
        sourceSeverity: "high",
        description: "Administrative panel detected.",
        authorization: credential,
        secretFilePath: secretPath,
        protectedEvidence,
        references: Array.from(
          { length: 12 },
          (_, index) => `https://reference.test/${index}`,
        ),
      },
    };
    const toolRun: ToolRunSummary = {
      id: "run-traceable",
      toolName: "nuclei",
      command: `nuclei -sf ${secretPath} -H "Authorization: ${credential}"`,
      commandSource: "generated",
      status: "success",
      startedAt: "2026-07-01T10:20:00.000Z",
      endedAt: "2026-07-01T10:21:00.000Z",
      exitCode: 0,
    };
    const artifact: ToolRunArtifactRecord = {
      id: finding.toolRunArtifactId,
      toolRunId: toolRun.id,
      artifactType: "nuclei_findings",
      label: "Nuclei findings",
      source: secretPath,
      payload: {
        authorization: credential,
        protectedEvidence,
      },
      createdAt: "2026-07-01T10:21:00.000Z",
    };
    const writer = new FakeFileWriter();
    const service = new SessionReportService(
      new FakeSessionRepository([toolRun], [artifact]),
      new FakeFindingRepository([finding]),
      writer,
    );

    await service.exportMarkdown({
      sessionId: session.id,
      selectedFindingIds: [finding.id],
      outputPath: "/tmp/session-report.md",
    });

    const markdown = writer.writes[0]!.markdown;
    expect(markdown).toContain("#### Source Context");
    expect(markdown).toContain("- Artifact Path: `$.findings[4]`");
    expect(markdown).toContain("- Template ID: `exposed-panel`");
    expect(markdown).toContain(
      "- Matched Target: `https://example.test/api/secrets/list`",
    );
    expect(markdown).toContain("+9 more");
    expect(markdown).not.toContain(credential);
    expect(markdown).not.toContain(secretPath);
    expect(markdown).not.toContain(protectedEvidence);
    expect(markdown).not.toContain("Authorization");
  });

  it("redacts authentication values embedded in allowed report strings", async () => {
    const userInfoSecret = "userinfo-secret";
    const querySecret = "query-secret";
    const refreshTokenSecret = "refresh-token-secret";
    const idTokenSecret = "id-token-secret";
    const clientSecret = "client-secret-value";
    const headerSecret = "header-secret";
    const cookieSecret = "cookie-secret";
    const credentialTarget =
      `https://operator:${userInfoSecret}@example.test/admin` +
      `?access_token=${querySecret}` +
      `&refresh_token=${refreshTokenSecret}` +
      `&id_token=${idTokenSecret}` +
      `&client_secret=${clientSecret}`;
    const finding = {
      ...createFinding("allowed-fields", "confirmed"),
      summary: `Authorization: Bearer ${headerSecret}`,
      target: credentialTarget,
      payload: {
        artifactItemPath: "$.findings[0]",
        templateId: "allowed-fields",
        matchedAt: credentialTarget,
        description: `Cookie: session=${cookieSecret}`,
      },
    };
    const writer = new FakeFileWriter();
    const service = new SessionReportService(
      new FakeSessionRepository([], [], {
        ...session,
        displayUrl: credentialTarget,
      }),
      new FakeFindingRepository([finding]),
      writer,
    );

    await service.exportMarkdown({
      sessionId: session.id,
      selectedFindingIds: [finding.id],
      outputPath: "/tmp/session-report.md",
    });

    const markdown = writer.writes[0]!.markdown;
    expect(markdown).toContain("[redacted]");
    expect(markdown).not.toContain(userInfoSecret);
    expect(markdown).not.toContain(querySecret);
    expect(markdown).not.toContain(refreshTokenSecret);
    expect(markdown).not.toContain(idTokenSecret);
    expect(markdown).not.toContain(clientSecret);
    expect(markdown).not.toContain(headerSecret);
    expect(markdown).not.toContain(cookieSecret);
  });

  it("returns readable feedback when the report file cannot be written", async () => {
    const service = new SessionReportService(
      new FakeSessionRepository(),
      new FakeFindingRepository([createFinding("confirmed", "confirmed")]),
      new FailingFileWriter(),
    );

    const result = await service.exportMarkdown({
      sessionId: session.id,
      selectedFindingIds: ["confirmed"],
      outputPath: "/locked/session-report.md",
    });

    expect(result).toEqual({
      status: "error",
      message: "Unable to export Markdown report: EACCES: permission denied",
    });
  });

  it("exports operator-edited draft Markdown without rebuilding or mutating it", async () => {
    const writer = new FakeFileWriter();
    const service = new SessionReportService(
      new FakeSessionRepository(),
      new FakeFindingRepository([createFinding("confirmed", "confirmed")]),
      writer,
    );
    const editedMarkdown =
      "# Operator-edited report draft\n\nVerified summary and recommendation wording.";

    const result = await service.exportMarkdownContent({
      markdown: editedMarkdown,
      selectedFindingIds: ["confirmed"],
      outputPath: "/tmp/edited-session-report.md",
    });

    expect(result).toEqual({
      status: "success",
      outputPath: "/tmp/edited-session-report.md",
      findingCount: 1,
    });
    expect(writer.writes).toEqual([
      {
        outputPath: "/tmp/edited-session-report.md",
        markdown: editedMarkdown,
      },
    ]);
  });

  it("exports a portable empty state when no Findings are selected", async () => {
    const writer = new FakeFileWriter();
    const service = new SessionReportService(
      new FakeSessionRepository(),
      new FakeFindingRepository([]),
      writer,
    );

    const result = await service.exportMarkdown({
      sessionId: session.id,
      selectedFindingIds: [],
      outputPath: "/tmp/empty-session-report.md",
    });

    expect(result).toEqual({
      status: "success",
      outputPath: "/tmp/empty-session-report.md",
      findingCount: 0,
    });
    expect(writer.writes[0]!.markdown).toContain("## Findings\n\nNo Findings selected.");
  });

  it("builds the export from persisted session, run, artifact, Finding, and Review facts", async () => {
    const uniqueTarget = `https://persisted-${crypto.randomUUID()}.example.test/`;
    const target = sessionRepository.findOrCreateTarget(uniqueTarget, uniqueTarget);
    const persistedSession = sessionRepository.createSession(target.id);
    const run = sessionRepository.recordToolRun(persistedSession.id, {
      toolName: "nuclei",
      command: "nuclei -u persisted.example.test",
      commandSource: "generated",
      status: "success",
    });
    const artifact = sessionRepository.saveToolRunArtifact(run.id, {
      artifactType: "nuclei_findings",
      label: "Persisted Nuclei Findings",
      source: "artifacts/persisted-nuclei.jsonl",
      payload: {
        findings: [],
      },
    });
    const [finding] = findingRepository.upsertCandidates([
      {
        sessionId: persistedSession.id,
        toolRunArtifactId: artifact.id,
        candidate: {
          sourceTool: "nuclei",
          kind: "nuclei.http",
          severity: "high",
          title: "Persisted Finding",
          summary: "Loaded from persisted scanner-derived facts.",
          target: `${uniqueTarget}admin`,
          dedupeKeyParts: ["persisted-finding"],
          payload: {
            artifactFindingIndex: 0,
            artifactItemPath: "$.findings[0]",
            templateId: "persisted-template",
          },
        },
      },
    ]);
    findingRepository.setReviewStatus({
      findingId: finding!.id,
      reviewStatus: "confirmed",
    });
    const writer = new FakeFileWriter();
    const service = new SessionReportService(
      sessionRepository,
      findingRepository,
      writer,
    );

    const draft = service.createDraft(persistedSession.id);
    await service.exportMarkdown({
      sessionId: persistedSession.id,
      selectedFindingIds: draft!.selectedFindingIds,
      outputPath: "/tmp/persisted-session-report.md",
    });

    expect(draft?.selectedFindingIds).toEqual([finding!.id]);
    expect(writer.writes[0]!.markdown).toContain("Persisted Finding");
    expect(writer.writes[0]!.markdown).toContain(`- Tool Run ID: \`${run.id}\``);
    expect(writer.writes[0]!.markdown).toContain(`- Artifact ID: \`${artifact.id}\``);
    expect(writer.writes[0]!.markdown).toContain(
      "- Artifact Label: Persisted Nuclei Findings",
    );
  });
});
