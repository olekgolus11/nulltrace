import { afterEach, describe, expect, it } from "bun:test";
import { testRender } from "@opentui/react/test-utils";
import { useKeyboard } from "@opentui/react";
import { KeyEvent } from "@opentui/core";
import { act, useState } from "react";
import { SqlmapToolData } from "../../types/sqlmap.types";
import { sqlmapCommandService } from "../../services/sqlmap-command.service";
import { toolRegistry } from "../../../shared/registry/tool-registry";
import { SqlmapForm } from "../SqlmapForm";

let testSetup: Awaited<ReturnType<typeof testRender>> | null = null;

function SqlmapInteractionHarness() {
  const [toolData, setToolData] = useState<SqlmapToolData>(() =>
    sqlmapCommandService.createInitialToolData("http://127.0.0.1:3000/products?id=1"),
  );
  const handleKey = (name: string) => {
    toolRegistry.sqlmap!.handleFormKey?.(
      { name },
      {
        toolName: "sqlmap",
        sessionId: "session-1",
        targetUrl: toolData.form.targetUrl,
        activePanel: "form",
        isHelpOpen: false,
        commandInput: sqlmapCommandService.buildCommand(toolData),
        generatedCommand: sqlmapCommandService.buildCommand(toolData),
        commandSource: "generated",
        outputLines: [],
        executionStatus: "idle",
        lastExitCode: null,
        currentToolRunId: null,
        historyRuns: [],
        selectedHistoryRunId: null,
        selectedHistoryRun: null,
        isHistoricPreview: false,
        toolData,
      },
      {
        updateToolData: (updater) => setToolData((current) => updater(current) as SqlmapToolData),
        syncGeneratedCommand: () => {},
        toggleHelp: () => {},
      },
    );
  };
  useKeyboard((key) => handleKey(key.name));

  return (
    <box flexDirection="column">
      <SqlmapForm
        form={toolData.form}
        selectedField={toolData.selectedField}
        focused={true}
        onFieldChange={(field, value) =>
          setToolData((current) => sqlmapCommandService.setField(current, field, value))
        }
      />
      <text>{`method:${toolData.form.method}`}</text>
    </box>
  );
}

afterEach(async () => {
  await act(async () => testSetup?.renderer.destroy());
  testSetup = null;
});

describe("SqlmapForm", () => {
  it("renders targeted safety bounds and guided fields", async () => {
    const data = sqlmapCommandService.createInitialToolData(
      "http://127.0.0.1:3000/products?id=1",
    );
    testSetup = await testRender(
      <SqlmapForm
        form={data.form}
        selectedField={0}
        focused={true}
        onFieldChange={() => {}}
      />,
      { width: 100, height: 18 },
    );

    await testSetup.renderOnce();
    const frame = testSetup.captureCharFrame();
    expect(frame).toContain("one endpoint + one parameter");
    expect(frame).toContain("Target URL");
    expect(frame).toContain("Method");
    expect(frame).toContain("Time limit");
    expect(frame).toContain("Extra safe options");
    expect(frame).not.toContain("dump");
    expect(frame).not.toContain("shell");
  });

  it("supports keyboard navigation and method cycling through the registered workspace", async () => {
    testSetup = await testRender(<SqlmapInteractionHarness />, { width: 100, height: 20 });
    await testSetup.renderOnce();
    expect(testSetup.captureCharFrame()).toContain("method:GET");

    await act(async () => {
      emitKey("down", "\u001b[B");
    });
    await testSetup.renderOnce();
    await act(async () => {
      emitKey("right", "\u001b[C");
      expect(toolRegistry.sqlmap!.id).toBe("sqlmap");
    });
    await testSetup.renderOnce();

    expect(testSetup.captureCharFrame()).toContain("method:POST");
  });
});

function emitKey(name: string, sequence: string) {
  testSetup?.renderer.keyInput.emit(
    "keypress",
    new KeyEvent({
      name,
      sequence,
      raw: sequence,
      ctrl: false,
      shift: false,
      meta: false,
      option: false,
      number: false,
      eventType: "press",
      source: "raw",
      repeated: false,
    }),
  );
}
