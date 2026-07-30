import { resolve } from "node:path";
import {
  SessionReportDraft,
  SessionReportExportInput,
  SessionReportExportResult,
  SessionReportFileWriter,
  SessionReportFindingRepository,
  SessionReportSessionRepository,
} from "../model/session-report.types";
import { createSessionReportMarkdown } from "./session-report-markdown.helpers";

export class SessionReportService {
  constructor(
    private readonly sessions: SessionReportSessionRepository,
    private readonly findings: SessionReportFindingRepository,
    private readonly fileWriter: SessionReportFileWriter,
  ) {}

  createDraft(sessionId: string): SessionReportDraft | null {
    const session = this.sessions.getSessionById(sessionId);

    if (!session) {
      return null;
    }

    const findings = this.findings.listBySessionId(sessionId).map((finding) => {
      const artifact = this.sessions.findToolRunArtifactByIdForSession(
        sessionId,
        finding.toolRunArtifactId,
      );

      return {
        ...finding,
        toolRunId: artifact?.toolRunId ?? null,
        artifactType: artifact?.artifactType ?? null,
        artifactLabel: artifact?.label ?? null,
        artifactCreatedAt: artifact?.createdAt ?? null,
      };
    });

    return {
      session,
      toolRuns: this.sessions.listToolRunsBySessionId(sessionId),
      findings,
      selectedFindingIds: findings
        .filter((finding) => finding.reviewStatus === "confirmed")
        .map((finding) => finding.id),
    };
  }

  async exportMarkdown({
    sessionId,
    selectedFindingIds,
    outputPath,
  }: SessionReportExportInput): Promise<SessionReportExportResult> {
    const trimmedOutputPath = outputPath.trim();

    if (!trimmedOutputPath) {
      return {
        status: "error",
        message: "Choose an output path for the Markdown report.",
      };
    }

    const draft = this.createDraft(sessionId);

    if (!draft) {
      return {
        status: "error",
        message: "Testing session was not found.",
      };
    }

    const markdown = createSessionReportMarkdown(draft, selectedFindingIds);
    const resolvedOutputPath = resolve(trimmedOutputPath);
    try {
      await this.fileWriter.write(resolvedOutputPath, markdown);
    } catch (error) {
      return {
        status: "error",
        message: `Unable to export Markdown report: ${
          error instanceof Error ? error.message : String(error)
        }`,
      };
    }

    return {
      status: "success",
      outputPath: resolvedOutputPath,
      findingCount: draft.findings.filter((finding) =>
        selectedFindingIds.includes(finding.id),
      ).length,
    };
  }
}
