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
      command: "nmap scanme.nmap.org",
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
      command: "nmap scanme.nmap.org",
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

  it("redacts preparation failures before persisting or displaying them", async () => {
    const recordToolRun = mock(() => createToolRunRecord());
    const appendToolRunLog = mock(() => {});
    const system = mock(() => {});
    const service = new ToolRunnerService(
      {
        run: mock(async () => 0),
        stop: mock(() => {}),
      },
      { processCompletedRun: mock(async () => {}) },
      {
        recordToolRun,
        appendToolRunLog,
        finishToolRun: mock(() => {}),
        cancelToolRun: mock(() => {}),
      },
    );
    const redact = (content: string) =>
      content
        .replaceAll("/Users/alice/private/targets.txt", "[local path redacted]")
        .replaceAll("environment-secret-value", "[redacted]");

    await service.run({
      sessionId: "session-1",
      toolName: "sqlmap",
      command:
        "sqlmap -u 'http://example.test/?id=1' -p id -m /Users/alice/private/targets.txt --string environment-secret-value",
      commandSource: "manual",
      toolModule: createToolModule(
        () => {
          throw new Error(
            "Rejected /Users/alice/private/targets.txt environment-secret-value",
          );
        },
        redact,
      ),
      onStdoutLines: mock(() => {}),
      onStderrLines: mock(() => {}),
      onSystemLines: system,
    });

    expect(recordToolRun).toHaveBeenCalledWith(
      "session-1",
      expect.objectContaining({
        command: expect.not.stringContaining("/Users/alice"),
      }),
    );
    expect(appendToolRunLog).toHaveBeenCalledWith("run-1", [
      "",
      "[execution failed] Rejected [local path redacted] [redacted]",
    ]);
    expect(system).toHaveBeenCalledWith([
      "",
      "[execution failed] Rejected [local path redacted] [redacted]",
    ]);
  });

  it("passes a prepared total time limit to the execution boundary", async () => {
    const run = mock(async () => 0);
    const service = new ToolRunnerService(
      {
        run,
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
      toolName: "sqlmap",
      command: "sqlmap -u 'http://example.test/?id=1' -p id",
      commandSource: "generated",
      toolModule: createToolModule(() => ({
        command: "sqlmap -u 'http://example.test/?id=1' -p id --batch",
        timeoutMs: 120_000,
      })),
      onStdoutLines: mock(() => {}),
      onStderrLines: mock(() => {}),
      onSystemLines: mock(() => {}),
    });

    expect(run).toHaveBeenCalledWith(
      "sqlmap -u 'http://example.test/?id=1' -p id --batch",
      expect.any(Function),
      expect.any(Function),
      { timeoutMs: 120_000 },
    );
  });

  it("redacts authenticated output before displaying or persisting it", async () => {
    const appendToolRunLog = mock(() => {});
    const stdout = mock(() => {});
    const stderr = mock(() => {});
    const service = new ToolRunnerService(
      {
        run: mock(async (_command, onStdoutLines, onStderrLines) => {
          onStdoutLines(["reflected secret-token"]);
          onStderrLines(["cookie secret-cookie"]);
          return 0;
        }),
        stop: mock(() => {}),
      },
      { processCompletedRun: mock(async () => {}) },
      {
        recordToolRun: mock(() => createToolRunRecord()),
        appendToolRunLog,
        finishToolRun: mock(() => {}),
        cancelToolRun: mock(() => {}),
      },
    );
    const redactOutput = (content: string) =>
      content.replaceAll("secret-token", "[redacted]").replaceAll("secret-cookie", "[redacted]");

    await service.run({
      sessionId: "session-1",
      toolName: "nuclei",
      command: "nuclei -u https://example.com",
      commandSource: "generated",
      toolModule: createToolModule(() => ({
        command: "nuclei -sf /tmp/secret",
        redactOutput,
      })),
      onStdoutLines: stdout,
      onStderrLines: stderr,
      onSystemLines: mock(() => {}),
    });

    expect(stdout).toHaveBeenCalledWith(["reflected [redacted]"]);
    expect(stderr).toHaveBeenCalledWith(["cookie [redacted]"]);
    expect(JSON.stringify(appendToolRunLog.mock.calls)).not.toContain("secret-token");
    expect(JSON.stringify(appendToolRunLog.mock.calls)).not.toContain("secret-cookie");
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

  it("finalizes authenticated artifacts after a cancelled process stops", async () => {
    let finishProcess: (() => void) | null = null;
    const processCompletedRun = mock(async () => {});
    const redactArtifact = (content: string) => content.replaceAll("secret", "[redacted]");
    const service = new ToolRunnerService(
      {
        run: mock(
          () =>
            new Promise<number>((resolve) => {
              finishProcess = () => resolve(130);
            }),
        ),
        stop: mock(() => {
          finishProcess?.();
        }),
      },
      { processCompletedRun },
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
        redactArtifact,
      })),
      onStdoutLines: mock(() => {}),
      onStderrLines: mock(() => {}),
      onSystemLines: mock(() => {}),
    });
    await Promise.resolve();

    service.stop();
    await runPromise;

    expect(processCompletedRun).toHaveBeenCalledWith({
      sessionId: "session-1",
      toolRunId: "run-1",
      toolModule: expect.any(Object),
      status: "cancelled",
      exitCode: 130,
      command: "nuclei -u https://example.com",
      redactArtifact,
    });
  });

  it("finalizes authenticated artifacts when cancellation rejects the process", async () => {
    let rejectProcess: ((error: Error) => void) | null = null;
    const processCompletedRun = mock(async () => {});
    const redactArtifact = (content: string) => content.replaceAll("secret", "[redacted]");
    const service = new ToolRunnerService(
      {
        run: mock(
          () =>
            new Promise<number>((_resolve, reject) => {
              rejectProcess = reject;
            }),
        ),
        stop: mock(() => {
          rejectProcess?.(new Error("process terminated"));
        }),
      },
      { processCompletedRun },
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
        redactArtifact,
      })),
      onStdoutLines: mock(() => {}),
      onStderrLines: mock(() => {}),
      onSystemLines: mock(() => {}),
    });
    await Promise.resolve();

    service.stop();
    await runPromise;

    expect(processCompletedRun).toHaveBeenCalledWith({
      sessionId: "session-1",
      toolRunId: "run-1",
      toolModule: expect.any(Object),
      status: "cancelled",
      exitCode: null,
      command: "nuclei -u https://example.com",
      redactArtifact,
    });
  });

  it("bounds persisted and displayed scanner output", async () => {
    const appendToolRunLog = mock(() => {});
    const stdout = mock(() => {});
    const service = new ToolRunnerService(
      {
        run: mock(async (_command, onStdoutLines) => {
          onStdoutLines(Array.from({ length: 2001 }, (_value, index) => `line-${index}`));
          return 0;
        }),
        stop: mock(() => {}),
      },
      { processCompletedRun: mock(async () => {}) },
      {
        recordToolRun: mock(() => createToolRunRecord()),
        appendToolRunLog,
        finishToolRun: mock(() => {}),
        cancelToolRun: mock(() => {}),
      },
    );

    await service.run({
      sessionId: "session-1",
      toolName: "ffuf",
      command: "ffuf -u https://example.com/FUZZ",
      commandSource: "generated",
      toolModule: createToolModule(),
      onStdoutLines: stdout,
      onStderrLines: mock(() => {}),
      onSystemLines: mock(() => {}),
    });

    expect(stdout).toHaveBeenCalledWith(
      Array.from({ length: 2000 }, (_value, index) => `line-${index}`),
    );
    expect(stdout).toHaveBeenCalledWith(["[output truncated after 2000 lines]"]);
    expect(appendToolRunLog).toHaveBeenCalledWith(
      "run-1",
      ["[output truncated after 2000 lines]"],
      "stdout",
    );
  });
});
