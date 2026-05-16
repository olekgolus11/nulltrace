import { ToolRunArtifactRecord } from "../../session/model/session.repository.types";

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
