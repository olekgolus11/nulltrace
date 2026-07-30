import { SessionFindingRecord } from "../../finding/model/finding.types";
import {
  ToolRunArtifactRecord,
  ToolRunSummary,
} from "../../session/model/session.repository.types";

export interface SessionReportSessionFact {
  id: string;
  targetId: string;
  normalizedUrl: string;
  displayUrl: string;
  createdAt: string;
  lastActivityAt: string;
}

export interface SessionReportSessionRepository {
  getSessionById(sessionId: string): SessionReportSessionFact | null;
  listToolRunsBySessionId(sessionId: string): ToolRunSummary[];
  findToolRunArtifactByIdForSession(
    sessionId: string,
    artifactId: string,
  ): ToolRunArtifactRecord | null;
}

export interface SessionReportFindingRepository {
  listBySessionId(sessionId: string): SessionFindingRecord[];
}

export interface SessionReportFileWriter {
  write(outputPath: string, markdown: string): Promise<void>;
}

export interface SessionReportFinding extends SessionFindingRecord {
  toolRunId: string | null;
  artifactType: string | null;
  artifactLabel: string | null;
  artifactCreatedAt: string | null;
}

export interface SessionReportSourceContextField {
  label: string;
  value: string;
}

export interface SessionReportDraft {
  session: SessionReportSessionFact;
  toolRuns: ToolRunSummary[];
  findings: SessionReportFinding[];
  selectedFindingIds: string[];
}

export interface SessionReportExportInput {
  sessionId: string;
  selectedFindingIds: string[];
  outputPath: string;
}

export type SessionReportExportResult =
  | {
      status: "success";
      outputPath: string;
      findingCount: number;
    }
  | {
      status: "error";
      message: string;
    };
