import { ToolModule, ToolRunCompleted } from "../types/tool-screen.types";
import { sessionRepository } from "../../../session/services/session.repository";
import { sessionFindingPipelineService } from "../../../session-finding/services/session-finding-pipeline.service";

export interface ProcessCompletedRunInput extends ToolRunCompleted {
  sessionId: string | null;
  toolRunId: string | null;
  toolModule: ToolModule | undefined;
  onArtifactProcessingError?: (message: string) => void;
}

interface SessionFindingPipelineAdapter {
  processArtifacts: (input: {
    sessionId: string;
    artifacts: ReturnType<typeof sessionRepository.saveToolRunArtifact>[];
  }) => void;
}

interface SessionRepositoryAdapter {
  saveToolRunArtifact: typeof sessionRepository.saveToolRunArtifact;
  appendToolRunLog: typeof sessionRepository.appendToolRunLog;
}

export class ToolArtifactPipelineService {
  constructor(
    private readonly findingPipeline: SessionFindingPipelineAdapter = sessionFindingPipelineService,
    private readonly repository: SessionRepositoryAdapter = sessionRepository,
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
