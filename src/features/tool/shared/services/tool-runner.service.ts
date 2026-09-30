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
  toolName: string | null;
  toolModule: ToolModule | undefined;
  onSystemLines: (lines: string[]) => void;
  onRunCancelled?: (event: { toolRunId: string | null }) => void;
  onRunCleanupPending?: (event: { toolRunId: string | null }) => void;
  cancelled: boolean;
  cancellationRecorded: boolean;
  isolatedExpected: boolean;
  isolatedExecution: import("../types/tool-screen.types").ToolPreparedIsolatedRun["execution"] | null;
  cleanupConfirmed: boolean;
  cleanupPending: boolean;
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
  onRunCleanupPending?: (event: { toolRunId: string | null }) => void;
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
    onRunCleanupPending,
  }: RunToolCommandInput) {
    if (toolName === "curl" && this.activeRun?.toolName === "curl") {
      onSystemLines(["[previous isolated cURL run is still awaiting broker cleanup]"]);
      return;
    }
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
      toolName,
      onSystemLines,
      onRunCancelled,
      onRunCleanupPending,
      cancelled: false,
      cancellationRecorded: false,
      isolatedExpected: toolName === "curl",
      isolatedExecution: null,
      cleanupConfirmed: false,
      cleanupPending: false,
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
      const isIsolated = typeof prepared === "object" && prepared !== null && "execution" in prepared;
      if (toolName === "curl" && !isIsolated) {
        throw new Error("cURL requires the isolated public worker; local execution is disabled.");
      }
      if (isIsolated && toolName !== "curl") {
        throw new Error("Isolated execution is unavailable for this tool.");
      }
      const preparedCommand = isIsolated ? "" : typeof prepared === "string" ? prepared : prepared.command;
      redactPreparedOutput = typeof prepared === "string" ? undefined : prepared.redactOutput;
      redactPreparedArtifact = typeof prepared === "string" ? undefined : prepared.redactArtifact;
      preparePreparedArtifacts = typeof prepared === "string" || isIsolated ? undefined : prepared.prepareArtifacts;
      const preparedSystemLines = typeof prepared === "string" ? [] : prepared.systemLines ?? [];
      const timeoutMs = typeof prepared === "string" || isIsolated ? undefined : prepared.timeoutMs;
      let hasCleanedPreparedRun = false;
      activeRun.cleanupPreparedRun =
        typeof prepared === "string" || isIsolated || !prepared.cleanup
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
        if (isIsolated) {
          activeRun.isolatedExecution = prepared.execution;
          const receipt = await prepared.execution.cancel();
          if (receipt.cleanup === "confirmed") {
            activeRun.cleanupConfirmed = true;
            this.recordCancellation(activeRun);
          }
          else onRunCleanupPending?.({ toolRunId });
        } else {
          activeRun.cleanupConfirmed = true;
          this.recordCancellation(activeRun);
        }
        return;
      }

      if (preparedSystemLines.length > 0) {
        const redactedSystemLines = redactPreparedOutput
          ? preparedSystemLines.map(redactPreparedOutput)
          : preparedSystemLines;
        if (toolRunId) {
          this.repository.appendToolRunLog(toolRunId, redactedSystemLines);
        }
        onSystemLines(redactedSystemLines);
      }

      const handleStdout = (lines: string[]) => {
        const redactedLines = redactPreparedOutput ? lines.map(redactPreparedOutput) : lines;
        this.emitBoundedOutput(activeRun, redactedLines, "stdout", onStdoutLines);
      };
      const handleStderr = (lines: string[]) => {
        const redactedLines = redactPreparedOutput ? lines.map(redactPreparedOutput) : lines;
        this.emitBoundedOutput(activeRun, redactedLines, "stderr", onStderrLines);
      };
      const handleSystem = (lines: string[]) => {
        const redactedLines = redactPreparedOutput ? lines.map(redactPreparedOutput) : lines;
        this.emitBoundedOutput(activeRun, redactedLines, "system", onSystemLines);
      };
      if (isIsolated) activeRun.isolatedExecution = prepared.execution;
      const exitCode = isIsolated
        ? await prepared.execution.run(handleStdout, handleStderr, handleSystem)
        : timeoutMs
        ? await this.commandRunner.run(
            preparedCommand,
            handleStdout,
            handleStderr,
            { timeoutMs },
          )
        : await this.commandRunner.run(preparedCommand, handleStdout, handleStderr);

      if (activeRun.cancelled) {
        activeRun.cleanupConfirmed = true;
        this.recordCancellation(activeRun);
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
      if (activeRun.isolatedExecution && !activeRun.cleanupConfirmed && !activeRun.cancelled) {
        const cleanup = await activeRun.isolatedExecution.cancel();
        if (cleanup.cleanup === "confirmed") activeRun.cleanupConfirmed = true;
        else {
          activeRun.cleanupPending = true;
          onSystemLines(["", "[execution failed; broker cleanup confirmation pending]"]);
          onRunCleanupPending?.({ toolRunId });
          return;
        }
      }
      if (activeRun.cancelled) {
        if (activeRun.isolatedExecution && !activeRun.cleanupConfirmed) {
          onSystemLines(["", "[cancellation requested; broker cleanup confirmation pending]"]);
          onRunCleanupPending?.({ toolRunId });
          return;
        }
        activeRun.cleanupConfirmed = true;
        this.recordCancellation(activeRun);
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
      const message = toolModule?.getSafeExecutionError
        ? toolModule.getSafeExecutionError(error) ?? "The tool failed with an unrecognized error."
        : redactPreparedOutput?.(rawMessage) ??
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
      if (this.activeRun === activeRun && !activeRun.cleanupPending && (!activeRun.cancelled || activeRun.cleanupConfirmed)) {
        this.activeRun = null;
      }
    }
  }

  stop() {
    if (!this.activeRun) {
      return;
    }

    if (this.activeRun.cancelled && !this.activeRun.isolatedExecution) return;

    this.activeRun.cancelled = true;

    if (this.activeRun.isolatedExpected) {
      const activeRun = this.activeRun;
      activeRun.onSystemLines(["", "[cancellation requested; waiting for isolated cleanup confirmation]"]);
      if (!activeRun.isolatedExecution) {
        activeRun.onRunCleanupPending?.({ toolRunId: activeRun.toolRunId });
        return;
      }
      void activeRun.isolatedExecution.cancel().then((receipt) => {
        if (receipt.cleanup === "confirmed") {
          activeRun.cleanupConfirmed = true;
          activeRun.cleanupPending = false;
          this.recordCancellation(activeRun);
          if (this.activeRun === activeRun) this.activeRun = null;
        } else {
          activeRun.onRunCleanupPending?.({ toolRunId: activeRun.toolRunId });
        }
      }).catch(() => {
        activeRun.onRunCleanupPending?.({ toolRunId: activeRun.toolRunId });
      });
      return;
    }

    this.recordCancellation(this.activeRun);
    this.activeRun.cleanupPreparedRun?.();
    this.commandRunner.stop();
  }

  private recordCancellation(activeRun: ActiveToolRun): void {
    if (activeRun.cancellationRecorded) return;
    activeRun.cancellationRecorded = true;
    const cancelMessage = "[run cancelled by operator]";
    if (activeRun.toolRunId) {
      this.repository.appendToolRunLog(activeRun.toolRunId, ["", cancelMessage]);
      this.repository.cancelToolRun(activeRun.toolRunId);
    }
    activeRun.onSystemLines(["", cancelMessage]);
    activeRun.onRunCancelled?.({ toolRunId: activeRun.toolRunId });
  }

  private emitBoundedOutput(
    activeRun: ActiveToolRun,
    lines: string[],
    stream: "stdout" | "stderr" | "system",
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
