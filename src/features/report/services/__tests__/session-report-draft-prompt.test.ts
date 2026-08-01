import { describe, expect, it } from "bun:test";
import { SessionReportDraft } from "../../model/session-report.types";
import { createSessionReportDraftPrompt } from "../session-report-draft-prompt.helpers";

const credential = "Bearer credential-must-not-reach-provider";
const secretPath = "/private/tmp/nulltrace-auth-secret.yaml";
const protectedEvidence = "protected-response-body-must-not-reach-provider";

function createDraft(): SessionReportDraft {
  return {
    session: {
      id: "session-1",
      targetId: "target-1",
      normalizedUrl: "https://example.test/",
      displayUrl: "https://example.test",
      createdAt: "2026-08-01T10:00:00.000Z",
      lastActivityAt: "2026-08-01T11:00:00.000Z",
    },
    toolRuns: [
      {
        id: "run-1",
        toolName: "nuclei",
        command: `nuclei -sf ${secretPath} -H "Authorization: ${credential}"`,
        commandSource: "generated",
        status: "success",
        startedAt: "2026-08-01T10:10:00.000Z",
        endedAt: "2026-08-01T10:11:00.000Z",
        exitCode: 0,
      },
      {
        id: "run-unselected",
        toolName: "nikto",
        command: "nikto -h https://example.test",
        commandSource: "generated",
        status: "success",
        startedAt: "2026-08-01T10:30:00.000Z",
        endedAt: "2026-08-01T10:31:00.000Z",
        exitCode: 0,
      },
    ],
    findings: [
      {
        id: "finding-confirmed",
        sessionId: "session-1",
        toolRunArtifactId: "artifact-1",
        toolRunId: "run-1",
        artifactType: "nuclei_findings",
        artifactLabel: "Nuclei Findings",
        artifactCreatedAt: "2026-08-01T10:11:00.000Z",
        sourceTool: "nuclei",
        kind: "nuclei.http",
        severity: "high",
        title: "Exposed administration panel",
        summary: `Panel found. Authorization: ${credential}. ${secretPath}`,
        target: "https://example.test/admin",
        fingerprint: "fingerprint-confirmed",
        payload: {
          artifactItemPath: "$.findings[0]",
          templateId: "exposed-panel",
          matchedAt: "https://example.test/admin",
          description: "Administrative panel detected.",
          authorization: credential,
          secretFilePath: secretPath,
          protectedEvidence,
        },
        reviewStatus: "confirmed",
        reviewUpdatedAt: "2026-08-01T10:20:00.000Z",
        firstSeenAt: "2026-08-01T10:10:00.000Z",
        lastSeenAt: "2026-08-01T10:10:00.000Z",
        createdAt: "2026-08-01T10:10:00.000Z",
      },
      {
        id: "finding-unselected",
        sessionId: "session-1",
        toolRunArtifactId: "artifact-2",
        toolRunId: "run-1",
        artifactType: "nuclei_findings",
        artifactLabel: "Nuclei Findings",
        artifactCreatedAt: "2026-08-01T10:11:00.000Z",
        sourceTool: "nuclei",
        kind: "nuclei.http",
        severity: "medium",
        title: "Unselected Finding",
        summary: "Must not reach provider.",
        target: "https://example.test/unselected",
        fingerprint: "fingerprint-unselected",
        payload: {},
        reviewStatus: "needs_review",
        reviewUpdatedAt: null,
        firstSeenAt: "2026-08-01T10:10:00.000Z",
        lastSeenAt: "2026-08-01T10:10:00.000Z",
        createdAt: "2026-08-01T10:10:00.000Z",
      },
    ],
    selectedFindingIds: ["finding-confirmed"],
  };
}

describe("createSessionReportDraftPrompt", () => {
  it("projects only selected bounded report facts through an explicit safe allowlist", () => {
    const prompt = createSessionReportDraftPrompt(createDraft(), ["finding-confirmed"]);

    expect(prompt).toContain("finding-confirmed");
    expect(prompt).toContain("exposed-panel");
    expect(prompt).toContain("$.findings[0]");
    expect(prompt).not.toContain("finding-unselected");
    expect(prompt).not.toContain("Unselected Finding");
    expect(prompt).not.toContain("run-unselected");
    expect(prompt).not.toContain("nikto");
    expect(prompt).not.toContain("nuclei -sf");
    expect(prompt).not.toContain(credential);
    expect(prompt).not.toContain(secretPath);
    expect(prompt).not.toContain(protectedEvidence);
  });

  it("rejects an unbounded Finding selection without weakening deterministic export", () => {
    const draft = createDraft();
    draft.findings = Array.from({ length: 26 }, (_, index) => ({
      ...draft.findings[0]!,
      id: `finding-${index}`,
    }));

    expect(() =>
      createSessionReportDraftPrompt(
        draft,
        draft.findings.map((finding) => finding.id),
      ),
    ).toThrow("Select no more than 25 Findings for LLM-assisted drafting.");
  });
});
