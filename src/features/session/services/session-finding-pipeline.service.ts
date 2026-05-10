import {
  SessionFindingMapper,
  UpsertSessionFindingCandidateInput,
} from "../model/session-finding.types";
import { ToolRunArtifactRecord } from "../model/session.repository.types";
import { sessionFindingRepository } from "./session-finding.repository";

interface ProcessSessionFindingArtifactsInput {
  sessionId: string;
  artifacts: ToolRunArtifactRecord[];
}

interface SessionFindingRepositoryAdapter {
  upsertCandidates: (inputs: UpsertSessionFindingCandidateInput[]) => unknown[];
}

export class SessionFindingPipelineService {
  constructor(
    private readonly mappers: SessionFindingMapper[] = [],
    private readonly repository: SessionFindingRepositoryAdapter = sessionFindingRepository,
  ) {}

  processArtifacts({
    sessionId,
    artifacts,
  }: ProcessSessionFindingArtifactsInput) {
    artifacts.forEach((artifact) => {
      const mapper = this.mappers.find(
        (candidate) => candidate.artifactType === artifact.artifactType,
      );

      if (!mapper) {
        return;
      }

      const upsertInputs = mapper
        .mapArtifact(artifact)
        .map<UpsertSessionFindingCandidateInput>((candidate) => ({
          sessionId,
          toolRunArtifactId: artifact.id,
          candidate,
        }));

      if (upsertInputs.length === 0) {
        return;
      }

      this.repository.upsertCandidates(upsertInputs);
    });
  }
}

export const sessionFindingPipelineService =
  new SessionFindingPipelineService();
