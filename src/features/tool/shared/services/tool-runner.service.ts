import { sessionRepository } from "../../../session/services/session.repository";
import { ToolModule } from "../types/tool-screen.types";
import { commandRunnerService } from "./command-runner.service";
import { toolArtifactPipelineService } from "./tool-artifact-pipeline.service";

interface CommandRunnerContract {
  run: typeof commandRunnerService.run;
  stop: typeof commandRunnerService.stop;
}

interface ToolArtifactPipelineContract {
  processCompletedRun: typeof toolArtifactPipelineService.processCompletedRun;
}

interface SessionRepositoryContract {
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
  cleanupPreparedRun: (() => void) | null;
  emittedOutputLineCount: number;
  isOutputTruncated: boolean;
}

interface RunToolCommandInput {
  sessionId: string | null;
  toolName: string | null;
  command: string;
  commandSource: import("../types/tool-screen.types").CommandSource;
  toolModule: ToolModule | undefined;
  targetUrl?: string;
  toolData?: unknown;
  onRunStarted?: (toolRunId: string | null) => void;
  onStdoutLines: (lines: string[]) => void;
  onStderrLines: (lines: string[]) => void;
  onSystemLines: (lines: string[]) => void;
  onRunFinished?: (event: {
    toolRunId: string | null;
    status: Extract<import("../types/tool-screen.types").ExecutionStatus, "success" | "error">;
    exitCode: number | null;
  }) => void;
  onRunCancelled?: (event: { toolRunId: string | null }) => void;
}

export class ToolRunnerService {
  private activeRun: ActiveToolRun | null = null;
  private readonly maxOutputLineCount = 2000;

  constructor(
    private readonly commandRunner: CommandRunnerContract = commandRunnerService,
    private readonly artifactPipeline: ToolArtifactPipelineContract = toolArtifactPipelineService,
    private readonly repository: SessionRepositoryContract = sessionRepository,
  ) {}

  async run({
    sessionId,
    toolName,
    command,
    commandSource,
    toolModule,
    targetUrl,
    toolData,
    onRunStarted,
    onStdoutLines,
    onStderrLines,
    onSystemLines,
    onRunFinished,
    onRunCancelled,
  }: RunToolCommandInput) {
    const persistedCommand = toolModule?.redactCommandForPersistence?.(command) ?? command;
    const toolRun =
      sessionId && toolName
        ? this.repository.recordToolRun(sessionId, {
            toolName,
            command: persistedCommand,
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
      cleanupPreparedRun: null,
      emittedOutputLineCount: 0,
      isOutputTruncated: false,
    };

    this.activeRun = activeRun;
    onRunStarted?.(toolRunId);
    let redactPreparedOutput: ((content: string) => string) | undefined;
    let redactPreparedArtifact: ((content: string) => string) | undefined;
    let preparePreparedArtifacts: (() => void | Promise<void>) | undefined;

    try {
      const preparation =
        toolModule?.prepareCommandForRun?.({
          command,
          sessionId,
          toolRunId,
          targetUrl,
          toolData,
        }) ?? command;
      const prepared =
        typeof preparation === "object" && preparation !== null && "then" in preparation
          ? await preparation
          : preparation;
      const preparedCommand = typeof prepared === "string" ? prepared : prepared.command;
      redactPreparedOutput = typeof prepared === "string" ? undefined : prepared.redactOutput;
      redactPreparedArtifact = typeof prepared === "string" ? undefined : prepared.redactArtifact;
      preparePreparedArtifacts =
        typeof prepared === "string" ? undefined : prepared.prepareArtifacts;
      const timeoutMs = typeof prepared === "string" ? undefined : prepared.timeoutMs;
      let hasCleanedPreparedRun = false;
      activeRun.cleanupPreparedRun =
        typeof prepared === "string" || !prepared.cleanup
          ? null
          : () => {
              if (hasCleanedPreparedRun) {
                return;
              }
              hasCleanedPreparedRun = true;
              prepared.cleanup?.();
            };

      if (activeRun.cancelled) {
        activeRun.cleanupPreparedRun?.();
        return;
      }

      const handleStdout = (lines: string[]) => {
        const redactedLines = redactPreparedOutput ? lines.map(redactPreparedOutput) : lines;
        this.emitBoundedOutput(activeRun, redactedLines, "stdout", onStdoutLines);
      };
      const handleStderr = (lines: string[]) => {
        const redactedLines = redactPreparedOutput ? lines.map(redactPreparedOutput) : lines;
        this.emitBoundedOutput(activeRun, redactedLines, "stderr", onStderrLines);
      };
      const exitCode = timeoutMs
        ? await this.commandRunner.run(
            preparedCommand,
            handleStdout,
            handleStderr,
            { timeoutMs },
          )
        : await this.commandRunner.run(preparedCommand, handleStdout, handleStderr);

      if (activeRun.cancelled) {
        if (redactPreparedArtifact || preparePreparedArtifacts) {
          await this.artifactPipeline.processCompletedRun({
            sessionId,
            toolRunId,
            toolModule,
            status: "cancelled",
            exitCode,
            command,
            toolData,
            ...(redactPreparedOutput ? { redactOutput: redactPreparedOutput } : {}),
            ...(redactPreparedArtifact ? { redactArtifact: redactPreparedArtifact } : {}),
            ...(preparePreparedArtifacts ? { prepareArtifacts: preparePreparedArtifacts } : {}),
          });
        }
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
        command,
        toolData,
        ...(redactPreparedOutput ? { redactOutput: redactPreparedOutput } : {}),
        ...(redactPreparedArtifact ? { redactArtifact: redactPreparedArtifact } : {}),
        ...(preparePreparedArtifacts ? { prepareArtifacts: preparePreparedArtifacts } : {}),
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
        if (redactPreparedArtifact || preparePreparedArtifacts) {
          await this.artifactPipeline.processCompletedRun({
            sessionId,
            toolRunId,
            toolModule,
            status: "cancelled",
            exitCode: null,
            command,
            toolData,
            ...(redactPreparedOutput ? { redactOutput: redactPreparedOutput } : {}),
            ...(redactPreparedArtifact ? { redactArtifact: redactPreparedArtifact } : {}),
            ...(preparePreparedArtifacts ? { prepareArtifacts: preparePreparedArtifacts } : {}),
          });
        }
        return;
      }

      const rawMessage = error instanceof Error ? error.message : "Unknown execution error";
      const message =
        redactPreparedOutput?.(rawMessage) ??
        toolModule?.redactCommandForPersistence?.(rawMessage) ??
        rawMessage;
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
        command,
        toolData,
        ...(redactPreparedOutput ? { redactOutput: redactPreparedOutput } : {}),
        ...(redactPreparedArtifact ? { redactArtifact: redactPreparedArtifact } : {}),
        ...(preparePreparedArtifacts ? { prepareArtifacts: preparePreparedArtifacts } : {}),
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
      activeRun.cleanupPreparedRun?.();
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
      this.repository.appendToolRunLog(this.activeRun.toolRunId, ["", cancelMessage]);
      this.repository.cancelToolRun(this.activeRun.toolRunId);
    }
    this.activeRun.onSystemLines(["", cancelMessage]);
    this.activeRun.onRunCancelled?.({
      toolRunId: this.activeRun.toolRunId,
    });
    this.activeRun.cleanupPreparedRun?.();
    this.commandRunner.stop();
  }

  private emitBoundedOutput(
    activeRun: ActiveToolRun,
    lines: string[],
    stream: "stdout" | "stderr",
    onLines: (lines: string[]) => void,
  ) {
    const remainingLineCount = this.maxOutputLineCount - activeRun.emittedOutputLineCount;
    const visibleLines = lines.slice(0, Math.max(0, remainingLineCount));
    if (visibleLines.length > 0) {
      activeRun.emittedOutputLineCount += visibleLines.length;
      if (activeRun.toolRunId) {
        this.repository.appendToolRunLog(activeRun.toolRunId, visibleLines, stream);
      }
      onLines(visibleLines);
    }

    if (lines.length <= visibleLines.length || activeRun.isOutputTruncated) {
      return;
    }

    activeRun.isOutputTruncated = true;
    const truncationMessage = `[output truncated after ${this.maxOutputLineCount} lines]`;
    if (activeRun.toolRunId) {
      this.repository.appendToolRunLog(activeRun.toolRunId, [truncationMessage], stream);
    }
    onLines([truncationMessage]);
  }
}

export const toolRunnerService = new ToolRunnerService();
