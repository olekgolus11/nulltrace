import { sessionRepository } from "../../../session/services/session.repository";
import { ToolModule } from "../types/tool-screen.types";
import { commandRunnerService } from "./command-runner.service";
import { toolArtifactPipelineService } from "./tool-artifact-pipeline.service";

interface CommandRunnerAdapter {
  run: typeof commandRunnerService.run;
  stop: typeof commandRunnerService.stop;
}

interface ToolArtifactPipelineAdapter {
  processCompletedRun: typeof toolArtifactPipelineService.processCompletedRun;
}

interface SessionRepositoryAdapter {
  recordToolRun: typeof sessionRepository.recordToolRun;
  appendToolRunLog: typeof sessionRepository.appendToolRunLog;
  finishToolRun: typeof sessionRepository.finishToolRun;
  cancelToolRun: typeof sessionRepository.cancelToolRun;
}

interface ActiveToolRun {
  toolRunId: string | null;
  sessionId: string | null;
  toolModule: ToolModule | undefined;
  onSystemLines: (lines: string[]) => void;
  onRunCancelled?: (event: { toolRunId: string | null }) => void;
  cancelled: boolean;
}

interface RunToolCommandInput {
  sessionId: string | null;
  toolName: string | null;
  command: string;
  commandSource: import("../types/tool-screen.types").CommandSource;
  toolModule: ToolModule | undefined;
  onRunStarted?: (toolRunId: string | null) => void;
  onStdoutLines: (lines: string[]) => void;
  onStderrLines: (lines: string[]) => void;
  onSystemLines: (lines: string[]) => void;
  onRunFinished?: (event: {
    toolRunId: string | null;
    status: Extract<
      import("../types/tool-screen.types").ExecutionStatus,
      "success" | "error"
    >;
    exitCode: number | null;
  }) => void;
  onRunCancelled?: (event: { toolRunId: string | null }) => void;
}

export class ToolRunnerService {
  private activeRun: ActiveToolRun | null = null;

  constructor(
    private readonly commandRunner: CommandRunnerAdapter = commandRunnerService,
    private readonly artifactPipeline: ToolArtifactPipelineAdapter = toolArtifactPipelineService,
    private readonly repository: SessionRepositoryAdapter = sessionRepository,
  ) {}

  async run({
    sessionId,
    toolName,
    command,
    commandSource,
    toolModule,
    onRunStarted,
    onStdoutLines,
    onStderrLines,
    onSystemLines,
    onRunFinished,
    onRunCancelled,
  }: RunToolCommandInput) {
    const toolRun =
      sessionId && toolName
        ? this.repository.recordToolRun(sessionId, {
            toolName,
            command,
            commandSource,
            status: "running",
          })
        : null;
    const toolRunId = toolRun?.id ?? null;
    const activeRun: ActiveToolRun = {
      toolRunId,
      sessionId,
      toolModule,
      onSystemLines,
      onRunCancelled,
      cancelled: false,
    };

    this.activeRun = activeRun;
    onRunStarted?.(toolRunId);

    const preparedCommand =
      toolModule?.prepareCommandForRun?.({
        command,
        sessionId,
        toolRunId,
      }) ?? command;

    try {
      const exitCode = await this.commandRunner.run(
        preparedCommand,
        (lines) => {
          if (toolRunId) {
            this.repository.appendToolRunLog(toolRunId, lines, "stdout");
          }
          onStdoutLines(lines);
        },
        (lines) => {
          if (toolRunId) {
            this.repository.appendToolRunLog(toolRunId, lines, "stderr");
          }
          onStderrLines(lines);
        },
      );

      if (activeRun.cancelled) {
        return;
      }

      const exitMessage = `[process exited with code ${exitCode}]`;
      if (toolRunId) {
        this.repository.appendToolRunLog(toolRunId, ["", exitMessage]);
      }
      onSystemLines(["", exitMessage]);

      const status = exitCode === 0 ? "success" : "error";
      if (toolRunId) {
        this.repository.finishToolRun(toolRunId, status, exitCode);
      }

      await this.artifactPipeline.processCompletedRun({
        sessionId,
        toolRunId,
        toolModule,
        status,
        exitCode,
        onArtifactProcessingError: (artifactMessage) => {
          onSystemLines(["", artifactMessage]);
        },
      });

      onRunFinished?.({
        toolRunId,
        status,
        exitCode,
      });
    } catch (error) {
      if (activeRun.cancelled) {
        return;
      }

      const message =
        error instanceof Error ? error.message : "Unknown execution error";
      const failureMessage = `[execution failed] ${message}`;
      if (toolRunId) {
        this.repository.appendToolRunLog(toolRunId, ["", failureMessage]);
        this.repository.finishToolRun(toolRunId, "error", null);
      }
      onSystemLines(["", failureMessage]);

      await this.artifactPipeline.processCompletedRun({
        sessionId,
        toolRunId,
        toolModule,
        status: "error",
        exitCode: null,
        onArtifactProcessingError: (artifactMessage) => {
          onSystemLines(["", artifactMessage]);
        },
      });

      onRunFinished?.({
        toolRunId,
        status: "error",
        exitCode: null,
      });
    } finally {
      if (this.activeRun === activeRun) {
        this.activeRun = null;
      }
    }
  }

  stop() {
    if (!this.activeRun || this.activeRun.cancelled) {
      return;
    }

    this.activeRun.cancelled = true;

    const cancelMessage = "[run cancelled by operator]";
    if (this.activeRun.toolRunId) {
      this.repository.appendToolRunLog(this.activeRun.toolRunId, [
        "",
        cancelMessage,
      ]);
      this.repository.cancelToolRun(this.activeRun.toolRunId);
    }
    this.activeRun.onSystemLines(["", cancelMessage]);
    this.activeRun.onRunCancelled?.({
      toolRunId: this.activeRun.toolRunId,
    });
    this.commandRunner.stop();
  }
}

export const toolRunnerService = new ToolRunnerService();
