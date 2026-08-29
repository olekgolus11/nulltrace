import { ToolRunArtifactRecord } from "../../session/model/session.repository.types";
import { CanonicalFindingSeverity } from "../services/finding-severity";

export interface FindingCandidate {
  sourceTool: string;
  kind: string;
  severity: string;
  title: string;
  summary: string;
  target: string;
  dedupeKeyParts: string[];
  payload: unknown;
}

export interface FindingMapper {
  artifactType: string;
  mapArtifact: (artifact: ToolRunArtifactRecord) => FindingCandidate[];
}

export interface UpsertFindingCandidateInput {
  sessionId: string;
  toolRunArtifactId: string;
  candidate: FindingCandidate;
}

export interface AssistantFindingPayload {
  assistantReported: true;
  evidence: string;
  recommendation: string | null;
  sourceTool: string;
  sourceToolRunId: string;
}

export interface UpdateAssistantFindingInput {
  sessionId: string;
  findingId: string;
  severity: CanonicalFindingSeverity;
  title: string;
  summary: string;
  target: string;
  fingerprint: string;
  payload: AssistantFindingPayload;
}

export type FindingReviewStatus = "needs_review" | "confirmed" | "dismissed";

export interface SetFindingReviewStatusInput {
  findingId: string;
  reviewStatus: FindingReviewStatus;
}

export interface SessionFindingRecord {
  id: string;
  sessionId: string;
  toolRunArtifactId: string;
  sourceTool: string;
  kind: string;
  severity: CanonicalFindingSeverity;
  title: string;
  summary: string;
  target: string;
  fingerprint: string;
  payload: unknown;
  reviewStatus: FindingReviewStatus;
  reviewUpdatedAt: string | null;
  firstSeenAt: string;
  lastSeenAt: string;
  createdAt: string;
}
