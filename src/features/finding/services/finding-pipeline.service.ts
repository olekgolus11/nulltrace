import {
  FindingMapper,
  UpsertFindingCandidateInput,
} from "../model/finding.types";
import { ToolRunArtifactRecord } from "../../session/model/session.repository.types";
import { findingRepository } from "./finding.repository";
import { nmapFindingMapper } from "./nmap-finding.mapper";

interface ProcessFindingArtifactsInput {
  sessionId: string;
  artifacts: ToolRunArtifactRecord[];
}

interface FindingRepositoryContract {
  upsertCandidates: (inputs: UpsertFindingCandidateInput[]) => unknown[];
}

export class FindingPipelineService {
  constructor(
    private readonly mappers: FindingMapper[] = [],
    private readonly repository: FindingRepositoryContract = findingRepository,
  ) {}

  processArtifacts({ sessionId, artifacts }: ProcessFindingArtifactsInput) {
    artifacts.forEach((artifact) => {
      const mapper = this.mappers.find(
        (candidate) => candidate.artifactType === artifact.artifactType,
      );

      if (!mapper) {
        return;
      }

      const upsertInputs = mapper
        .mapArtifact(artifact)
        .map<UpsertFindingCandidateInput>((candidate) => ({
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

export const findingPipelineService = new FindingPipelineService([
  nmapFindingMapper,
]);
