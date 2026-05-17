import { ToolModule } from "../types/tool-screen.types";
import { sessionRepository } from "../../../session/services/session.repository";
import { findingPipelineService } from "../../../finding/services/finding-pipeline.service";

interface FindingPipelineContract {
  processArtifacts: (input: {
    sessionId: string;
    artifacts: ReturnType<typeof sessionRepository.saveToolRunArtifact>[];
  }) => void;
}

interface SessionRepositoryContract {
  saveToolRunArtifact: typeof sessionRepository.saveToolRunArtifact;
  appendToolRunLog: typeof sessionRepository.appendToolRunLog;
}

interface ProcessCompletedRunInput {
  sessionId: string | null;
  toolRunId: string | null;
  toolModule: ToolModule | undefined;
  status: import("../types/tool-screen.types").ExecutionStatus;
  exitCode: number | null;
  onArtifactProcessingError?: (message: string) => void;
}

export class ToolArtifactPipelineService {
  constructor(
    private readonly findingPipeline: FindingPipelineContract = findingPipelineService,
    private readonly repository: SessionRepositoryContract = sessionRepository,
  ) {}

  async processCompletedRun({
    sessionId,
    toolRunId,
    toolModule,
    status,
    exitCode,
    onArtifactProcessingError,
  }: ProcessCompletedRunInput) {
    if (!toolRunId || !toolModule?.collectArtifacts) {
      return;
    }

    try {
      const artifacts = await toolModule.collectArtifacts({
        sessionId,
        toolRunId,
        status,
        exitCode,
      });

      const savedArtifacts = artifacts.map((artifact) =>
        this.repository.saveToolRunArtifact(toolRunId, artifact),
      );

      if (sessionId) {
        this.findingPipeline.processArtifacts({
          sessionId,
          artifacts: savedArtifacts,
        });
      }
    } catch (artifactError) {
      const message =
        artifactError instanceof Error
          ? artifactError.message
          : "Unknown artifact parsing error";
      const artifactMessage = `[artifact parsing failed] ${message}`;
      this.repository.appendToolRunLog(toolRunId, ["", artifactMessage]);
      onArtifactProcessingError?.(artifactMessage);
    }
  }
}

export const toolArtifactPipelineService = new ToolArtifactPipelineService();
