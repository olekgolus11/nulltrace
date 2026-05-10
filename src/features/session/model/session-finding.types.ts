import { ToolRunArtifactRecord } from "./session.repository.types";

export interface SessionFindingCandidate {
  sourceTool: string;
  kind: string;
  severity: string;
  title: string;
  summary: string;
  target: string;
  dedupeKeyParts: string[];
  payload: unknown;
}

export interface SessionFindingMapper {
  artifactType: string;
  mapArtifact: (artifact: ToolRunArtifactRecord) => SessionFindingCandidate[];
}

export interface UpsertSessionFindingCandidateInput {
  sessionId: string;
  toolRunArtifactId: string;
  candidate: SessionFindingCandidate;
}
