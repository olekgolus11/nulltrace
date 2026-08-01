import { describe, expect, it } from "bun:test";
import {
  SaveSessionReportDraftInput,
  SessionReportDraftProviderInput,
  SessionReportDraftRecord,
  SessionReportDraftProvider,
  SessionReportDraftStore,
} from "../../model/session-report-draft.types";
import { SessionReportDraft } from "../../model/session-report.types";
import { SessionReportDraftService } from "../session-report-draft.service";

function createReportDraftFixture(): SessionReportDraft {
  return {
    session: {
      id: "session-1",
      targetId: "target-1",
      normalizedUrl: "https://example.test/",
      displayUrl: "https://example.test",
      createdAt: "2026-08-01T10:00:00.000Z",
      lastActivityAt: "2026-08-01T11:00:00.000Z",
    },
    toolRuns: [],
    findings: [
      {
        id: "finding-needs-review",
        sessionId: "session-1",
        toolRunArtifactId: "artifact-1",
        toolRunId: null,
        artifactType: "nuclei_findings",
        artifactLabel: "Nuclei Findings",
        artifactCreatedAt: "2026-08-01T10:11:00.000Z",
        sourceTool: "nuclei",
        kind: "nuclei.http",
        severity: "high",
        title: "Exposed panel",
        summary: "Scanner observed an exposed panel.",
        target: "https://example.test/admin",
        fingerprint: "fingerprint-1",
        payload: {
          artifactItemPath: "$.findings[0]",
          templateId: "exposed-panel",
        },
        reviewStatus: "needs_review",
        reviewUpdatedAt: null,
        firstSeenAt: "2026-08-01T10:10:00.000Z",
        lastSeenAt: "2026-08-01T10:10:00.000Z",
        createdAt: "2026-08-01T10:10:00.000Z",
      },
    ],
    selectedFindingIds: [],
  };
}

class FakeProvider implements SessionReportDraftProvider {
  prompts: string[] = [];

  async generate({ prompt }: SessionReportDraftProviderInput) {
    this.prompts.push(prompt);
    return JSON.stringify({
      executiveSummaryStyle: "review_status",
      findings: [
        {
          findingId: "finding-needs-review",
          descriptionStyle: "review_focused",
          recommendationActions: ["verify", "remediate", "retest"],
        },
      ],
    });
  }
}

class FailingProvider implements SessionReportDraftProvider {
  async generate(): Promise<string> {
    throw new Error("provider timed out");
  }
}

class FreeFormClaimProvider implements SessionReportDraftProvider {
  async generate(): Promise<string> {
    return JSON.stringify({
      executiveSummary: "The target exposes plaintext administrator passwords.",
      findings: [
        {
          findingId: "finding-needs-review",
          description: "The target exposes plaintext administrator passwords.",
          recommendation: "Rotate passwords after verification.",
        },
      ],
    });
  }
}

class MemoryDraftStore implements SessionReportDraftStore {
  record: SessionReportDraftRecord | null = null;

  save(input: SaveSessionReportDraftInput) {
    const timestamp = "2026-08-01T12:00:00.000Z";
    this.record = {
      id: this.record?.id ?? "draft-1",
      ...input,
      createdAt: this.record?.createdAt ?? timestamp,
      updatedAt: timestamp,
    };
    return this.record;
  }

  findBySessionId(_sessionId: string) {
    return this.record;
  }
}

describe("SessionReportDraftService", () => {
  it("generates editable prose for explicit needs-review selection without saving automatically", async () => {
    const provider = new FakeProvider();
    const store = new MemoryDraftStore();
    const service = new SessionReportDraftService(
      { createDraft: () => createReportDraftFixture() },
      provider,
      store,
    );

    const result = await service.generate({
      sessionId: "session-1",
      selectedFindingIds: ["finding-needs-review"],
    });

    expect(result.status).toBe("success");
    if (result.status !== "success") {
      throw new Error(result.message);
    }
    expect(store.record).toBeNull();
    expect(provider.prompts[0]).toContain("finding-needs-review");
    expect(result.markdown).toContain("LLM-assisted editable draft requiring operator verification");
    expect(result.markdown).toContain("Finding ID: `finding-needs-review`");
    expect(result.markdown).toContain("Severity: `high`");
    expect(result.markdown).toContain("Source Tool: `nuclei`");
    expect(result.markdown).toContain("Review Status: `needs_review`");
    expect(result.markdown).toContain("This observation is unverified");
    expect(result.markdown).toContain("#### Source Context");
    expect(result.markdown).toContain("- Template ID: `exposed-panel`");
  });

  it("preserves current saved edits and returns readable fallback feedback on provider failure", async () => {
    const store = new MemoryDraftStore();
    store.save({
      sessionId: "session-1",
      selectedFindingIds: ["finding-needs-review"],
      markdown: "# Existing operator edits",
    });
    const service = new SessionReportDraftService(
      { createDraft: () => createReportDraftFixture() },
      new FailingProvider(),
      store,
    );

    const result = await service.generate({
      sessionId: "session-1",
      selectedFindingIds: ["finding-needs-review"],
    });

    expect(result).toEqual({
      status: "error",
      message:
        "Unable to generate LLM-assisted report draft: provider timed out. Deterministic Markdown export remains available.",
    });
    expect(store.findBySessionId("session-1")?.markdown).toBe("# Existing operator edits");
  });

  it("rejects stale or invented Finding selections before contacting the provider", async () => {
    const provider = new FakeProvider();
    const service = new SessionReportDraftService(
      { createDraft: () => createReportDraftFixture() },
      provider,
      new MemoryDraftStore(),
    );

    const result = await service.generate({
      sessionId: "session-1",
      selectedFindingIds: ["finding-does-not-exist"],
    });

    expect(result).toEqual({
      status: "error",
      message:
        "Selected Findings are no longer available. Review the selection before drafting. Deterministic Markdown export remains available.",
    });
    expect(provider.prompts).toEqual([]);
  });

  it("rejects free-form factual claims instead of treating them as scanner evidence", async () => {
    const service = new SessionReportDraftService(
      { createDraft: () => createReportDraftFixture() },
      new FreeFormClaimProvider(),
      new MemoryDraftStore(),
    );

    const result = await service.generate({
      sessionId: "session-1",
      selectedFindingIds: ["finding-needs-review"],
    });

    expect(result).toEqual({
      status: "error",
      message:
        "Unable to generate LLM-assisted report draft: Provider returned malformed report draft JSON. Deterministic Markdown export remains available.",
    });
  });
});
