import { describe, expect, it, mock } from "bun:test";
import { ToolRunnerService } from "../tool-runner.service";
import { ToolModule } from "../../types/tool-screen.types";

function createToolRunRecord() {
  return {
    id: "run-1",
    sessionId: "session-1",
    toolName: "nmap",
    command: "nmap scanme.nmap.org",
    commandSource: "generated" as const,
    status: "running",
    startedAt: "2026-05-10T10:00:00.000Z",
    endedAt: null,
    exitCode: null,
  };
}

function createToolModule(
  prepareCommandForRun?: ToolModule["prepareCommandForRun"],
  redactCommandForPersistence?: ToolModule["redactCommandForPersistence"],
): ToolModule {
  return {
    id: "nmap",
    name: "Nmap",
    description: "Test tool",
    Workspace: () => null,
    createInitialToolData: () => ({
      form: {},
      selectedField: 0,
    }),
    buildGeneratedCommand: () => "nmap scanme.nmap.org",
    prepareCommandForRun,
    redactCommandForPersistence,
  };
}

describe("ToolRunnerService", () => {
  it("records, executes, finishes, and triggers artifact processing for a successful run", async () => {
    const recordToolRun = mock(() => createToolRunRecord());
    const appendToolRunLog = mock(() => {});
    const finishToolRun = mock(() => {});
    const processCompletedRun = mock(async () => {});
    const stdout = mock(() => {});
    const stderr = mock(() => {});
    const system = mock(() => {});
    const onRunStarted = mock(() => {});
    const onRunFinished = mock(() => {});
    const service = new ToolRunnerService(
      {
        run: mock(async (_command, onStdoutLines, onStderrLines) => {
          onStdoutLines(["open port"]);
          onStderrLines(["warning"]);
          return 0;
        }),
        stop: mock(() => {}),
      },
      {
        processCompletedRun,
      },
      {
        recordToolRun,
        appendToolRunLog,
        finishToolRun,
        cancelToolRun: mock(() => {}),
      },
    );

    await service.run({
      sessionId: "session-1",
      toolName: "nmap",
      command: "nmap scanme.nmap.org",
      commandSource: "generated",
      toolModule: createToolModule(({ command }) => `${command} -oX out.xml`),
      onRunStarted,
      onStdoutLines: stdout,
      onStderrLines: stderr,
      onSystemLines: system,
      onRunFinished,
    });

    expect(recordToolRun).toHaveBeenCalledTimes(1);
    expect(onRunStarted).toHaveBeenCalledWith("run-1");
    expect(stdout).toHaveBeenCalledWith(["open port"]);
    expect(stderr).toHaveBeenCalledWith(["warning"]);
    expect(appendToolRunLog).toHaveBeenCalledWith("run-1", ["open port"], "stdout");
    expect(appendToolRunLog).toHaveBeenCalledWith("run-1", ["warning"], "stderr");
    expect(finishToolRun).toHaveBeenCalledWith("run-1", "success", 0);
    expect(processCompletedRun).toHaveBeenCalledWith({
      sessionId: "session-1",
      toolRunId: "run-1",
      toolModule: expect.any(Object),
      status: "success",
      exitCode: 0,
      onArtifactProcessingError: expect.any(Function),
    });
    expect(onRunFinished).toHaveBeenCalledWith({
      toolRunId: "run-1",
      status: "success",
      exitCode: 0,
    });
    expect(system).toHaveBeenCalledWith(["", "[process exited with code 0]"]);
  });

  it("marks a run as cancelled and does not finish or process artifacts afterwards", async () => {
    let stopRun: (() => void) | null = null;
    const appendToolRunLog = mock(() => {});
    const cancelToolRun = mock(() => {});
    const finishToolRun = mock(() => {});
    const processCompletedRun = mock(async () => {});
    const onRunCancelled = mock(() => {});
    const system = mock(() => {});
    const service = new ToolRunnerService(
      {
        run: mock(
          () =>
            new Promise<number>((resolve) => {
              stopRun = () => resolve(130);
            }),
        ),
        stop: mock(() => {
          stopRun?.();
        }),
      },
      {
        processCompletedRun,
      },
      {
        recordToolRun: mock(() => createToolRunRecord()),
        appendToolRunLog,
        finishToolRun,
        cancelToolRun,
      },
    );

    const runPromise = service.run({
      sessionId: "session-1",
      toolName: "nmap",
      command: "nmap scanme.nmap.org",
      commandSource: "generated",
      toolModule: createToolModule(),
      onStdoutLines: mock(() => {}),
      onStderrLines: mock(() => {}),
      onSystemLines: system,
      onRunCancelled,
    });

    service.stop();
    await runPromise;

    expect(appendToolRunLog).toHaveBeenCalledWith("run-1", ["", "[run cancelled by operator]"]);
    expect(cancelToolRun).toHaveBeenCalledWith("run-1");
    expect(onRunCancelled).toHaveBeenCalledWith({
      toolRunId: "run-1",
    });
    expect(system).toHaveBeenCalledWith(["", "[run cancelled by operator]"]);
    expect(finishToolRun).not.toHaveBeenCalled();
    expect(processCompletedRun).not.toHaveBeenCalled();
  });

  it("marks a thrown execution as an error and still triggers artifact processing", async () => {
    const appendToolRunLog = mock(() => {});
    const finishToolRun = mock(() => {});
    const processCompletedRun = mock(async () => {});
    const system = mock(() => {});
    const onRunFinished = mock(() => {});
    const service = new ToolRunnerService(
      {
        run: mock(async () => {
          throw new Error("spawn failed");
        }),
        stop: mock(() => {}),
      },
      {
        processCompletedRun,
      },
      {
        recordToolRun: mock(() => createToolRunRecord()),
        appendToolRunLog,
        finishToolRun,
        cancelToolRun: mock(() => {}),
      },
    );

    await service.run({
      sessionId: "session-1",
      toolName: "nmap",
      command: "nmap scanme.nmap.org",
      commandSource: "generated",
      toolModule: createToolModule(),
      onStdoutLines: mock(() => {}),
      onStderrLines: mock(() => {}),
      onSystemLines: system,
      onRunFinished,
    });

    expect(appendToolRunLog).toHaveBeenCalledWith("run-1", ["", "[execution failed] spawn failed"]);
    expect(finishToolRun).toHaveBeenCalledWith("run-1", "error", null);
    expect(processCompletedRun).toHaveBeenCalledWith({
      sessionId: "session-1",
      toolRunId: "run-1",
      toolModule: expect.any(Object),
      status: "error",
      exitCode: null,
      onArtifactProcessingError: expect.any(Function),
    });
    expect(onRunFinished).toHaveBeenCalledWith({
      toolRunId: "run-1",
      status: "error",
      exitCode: null,
    });
    expect(system).toHaveBeenCalledWith(["", "[execution failed] spawn failed"]);
  });

  it("records a redacted command and cleans prepared state after success", async () => {
    const recordToolRun = mock(() => createToolRunRecord());
    const cleanup = mock(() => {});
    const service = new ToolRunnerService(
      {
        run: mock(async () => 0),
        stop: mock(() => {}),
      },
      { processCompletedRun: mock(async () => {}) },
      {
        recordToolRun,
        appendToolRunLog: mock(() => {}),
        finishToolRun: mock(() => {}),
        cancelToolRun: mock(() => {}),
      },
    );

    await service.run({
      sessionId: "session-1",
      toolName: "nuclei",
      command: "nuclei -H 'Authorization: Bearer secret-token'",
      commandSource: "manual",
      toolData: { form: { useAuthenticatedContext: true }, selectedField: 0 },
      toolModule: createToolModule(
        async () => ({ command: "nuclei -sf /tmp/secret", cleanup }),
        () => "nuclei -H '[redacted]'",
      ),
      onStdoutLines: mock(() => {}),
      onStderrLines: mock(() => {}),
      onSystemLines: mock(() => {}),
    });

    expect(recordToolRun).toHaveBeenCalledWith("session-1", {
      toolName: "nuclei",
      command: "nuclei -H '[redacted]'",
      commandSource: "manual",
      status: "running",
    });
    expect(cleanup).toHaveBeenCalledTimes(1);
  });

  it("cleans prepared state after execution failure", async () => {
    const cleanup = mock(() => {});
    const service = new ToolRunnerService(
      {
        run: mock(async () => {
          throw new Error("spawn failed");
        }),
        stop: mock(() => {}),
      },
      { processCompletedRun: mock(async () => {}) },
      {
        recordToolRun: mock(() => createToolRunRecord()),
        appendToolRunLog: mock(() => {}),
        finishToolRun: mock(() => {}),
        cancelToolRun: mock(() => {}),
      },
    );

    await service.run({
      sessionId: "session-1",
      toolName: "nuclei",
      command: "nuclei -u https://example.com",
      commandSource: "generated",
      toolModule: createToolModule(() => ({
        command: "nuclei -sf /tmp/secret",
        cleanup,
      })),
      onStdoutLines: mock(() => {}),
      onStderrLines: mock(() => {}),
      onSystemLines: mock(() => {}),
    });

    expect(cleanup).toHaveBeenCalledTimes(1);
  });

  it("cleans prepared state immediately when an active run is cancelled", async () => {
    let finishProcess: (() => void) | null = null;
    const cleanup = mock(() => {});
    const service = new ToolRunnerService(
      {
        run: mock(
          () =>
            new Promise<number>((resolve) => {
              finishProcess = () => resolve(130);
            }),
        ),
        stop: mock(() => {}),
      },
      { processCompletedRun: mock(async () => {}) },
      {
        recordToolRun: mock(() => createToolRunRecord()),
        appendToolRunLog: mock(() => {}),
        finishToolRun: mock(() => {}),
        cancelToolRun: mock(() => {}),
      },
    );

    const runPromise = service.run({
      sessionId: "session-1",
      toolName: "nuclei",
      command: "nuclei -u https://example.com",
      commandSource: "generated",
      toolModule: createToolModule(() => ({
        command: "nuclei -sf /tmp/secret",
        cleanup,
      })),
      onStdoutLines: mock(() => {}),
      onStderrLines: mock(() => {}),
      onSystemLines: mock(() => {}),
    });
    await Promise.resolve();

    service.stop();
    expect(cleanup).toHaveBeenCalledTimes(1);
    (finishProcess as (() => void) | null)?.();
    await runPromise;
    expect(cleanup).toHaveBeenCalledTimes(1);
  });
});
