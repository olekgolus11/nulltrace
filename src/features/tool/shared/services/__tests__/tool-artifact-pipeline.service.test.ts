import { describe, expect, it, mock } from "bun:test";
import { ToolRunArtifactInput } from "../../../../session/model/session.repository.types";
import { ToolArtifactPipelineService } from "../tool-artifact-pipeline.service";
import { ToolModule } from "../../types/tool-screen.types";

function createToolModule(collectArtifacts?: ToolModule["collectArtifacts"]): ToolModule {
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
    collectArtifacts,
  };
}

describe("ToolArtifactPipelineService", () => {
  it("persists collected artifacts and forwards saved records to the finding pipeline", async () => {
    const savedArtifact = {
      id: "artifact-1",
      toolRunId: "run-1",
      artifactType: "nmap_scan",
      label: "Nmap scan",
      source: "nmap.xml",
      payload: { hosts: [] },
      createdAt: "2026-05-10T10:00:00.000Z",
    };
    const saveToolRunArtifact = mock(
      (_toolRunId: string, _artifact: ToolRunArtifactInput) => savedArtifact,
    );
    const processArtifacts = mock(() => {});
    const service = new ToolArtifactPipelineService(
      {
        processArtifacts,
      },
      {
        saveToolRunArtifact,
        appendToolRunLog: mock(() => {}),
      },
    );

    await service.processCompletedRun({
      sessionId: "session-1",
      toolRunId: "run-1",
      toolModule: createToolModule(async () => [
        {
          artifactType: "nmap_scan",
          label: "Nmap scan",
          source: "nmap.xml",
          payload: { hosts: [] },
        },
      ]),
      status: "success",
      exitCode: 0,
    });

    expect(saveToolRunArtifact).toHaveBeenCalledTimes(1);
    expect(processArtifacts).toHaveBeenCalledTimes(1);
    expect(processArtifacts).toHaveBeenCalledWith({
      sessionId: "session-1",
      artifacts: [savedArtifact],
    });
  });

  it("returns without error when toolRunId is missing", async () => {
    const saveToolRunArtifact = mock(() => {
      throw new Error("should not be called");
    });
    const service = new ToolArtifactPipelineService(
      {
        processArtifacts: mock(() => {}),
      },
      {
        saveToolRunArtifact,
        appendToolRunLog: mock(() => {}),
      },
    );

    await service.processCompletedRun({
      sessionId: "session-1",
      toolRunId: null,
      toolModule: createToolModule(async () => []),
      status: "success",
      exitCode: 0,
    });

    expect(saveToolRunArtifact).not.toHaveBeenCalled();
  });

  it("returns without error when the tool module does not collect artifacts", async () => {
    const saveToolRunArtifact = mock(() => {
      throw new Error("should not be called");
    });
    const service = new ToolArtifactPipelineService(
      {
        processArtifacts: mock(() => {}),
      },
      {
        saveToolRunArtifact,
        appendToolRunLog: mock(() => {}),
      },
    );

    await service.processCompletedRun({
      sessionId: "session-1",
      toolRunId: "run-1",
      toolModule: createToolModule(),
      status: "success",
      exitCode: 0,
    });

    expect(saveToolRunArtifact).not.toHaveBeenCalled();
  });

  it("appends the artifact failure log message and reports it to the caller", async () => {
    const appendToolRunLog = mock(() => {});
    const onArtifactProcessingError = mock(() => {});
    const service = new ToolArtifactPipelineService(
      {
        processArtifacts: mock(() => {}),
      },
      {
        saveToolRunArtifact: mock(() => {
          throw new Error("should not be called");
        }),
        appendToolRunLog,
      },
    );

    await service.processCompletedRun({
      sessionId: "session-1",
      toolRunId: "run-1",
      toolModule: createToolModule(async () => {
        throw new Error("parse failure");
      }),
      status: "error",
      exitCode: 1,
      onArtifactProcessingError,
    });

    expect(appendToolRunLog).toHaveBeenCalledWith("run-1", [
      "",
      "[artifact parsing failed] parse failure",
    ]);
    expect(onArtifactProcessingError).toHaveBeenCalledWith(
      "[artifact parsing failed] parse failure",
    );
  });
});
