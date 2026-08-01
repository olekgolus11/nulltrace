import { afterEach, expect, test } from "bun:test";
import { createMockKeys } from "@opentui/core/testing";
import { testRender } from "@opentui/react/test-utils";
import { useTerminalDimensions } from "@opentui/react";
import { act } from "react";
import { useToolLayout } from "../../../hooks/use-tool-layout";
import { useToolWorkspaceStore } from "../../../shared/store/tool-workspace.store";
import { niktoCommandService } from "../../services/nikto-command.service";
import { NiktoToolData } from "../../types/nikto.types";
import { NiktoWorkspace } from "../NiktoWorkspace";

let testSetup: Awaited<ReturnType<typeof testRender>> | null = null;

function NiktoWorkspaceBoundary() {
  const dimensions = useTerminalDimensions();
  const layout = useToolLayout(dimensions);

  return (
    <box flexDirection="column" width={dimensions.width} height={dimensions.height}>
      <box height={3}>
        <text>Workspace header</text>
      </box>
      <box height={layout.contentHeight}>
        <NiktoWorkspace />
      </box>
      <text>Workspace status</text>
    </box>
  );
}

function createCustomAuthenticatedToolData(): NiktoToolData {
  const customToolData = niktoCommandService.setProfile(
    niktoCommandService.createInitialToolData("https://example.com"),
    "custom",
  );

  return niktoCommandService.setAuthenticationAvailability(
    customToolData,
    "https://example.com",
  );
}

function configureWorkspace(toolData: NiktoToolData, outputLines: string[]) {
  const command = niktoCommandService.buildCommand(toolData);
  useToolWorkspaceStore.setState({
    toolName: "nikto",
    targetUrl: "https://example.com",
    toolData,
    commandInput: command,
    generatedCommand: command,
    outputLines,
    activePanel: "output",
  });
}

function createOutputLines(prefix: string): string[] {
  return Array.from({ length: 30 }, (_, index) => `${prefix}${index + 1}`);
}

async function renderWorkspaceBoundary(width: number, height: number) {
  testSetup = await testRender(<NiktoWorkspaceBoundary />, { width, height });
  await testSetup.renderOnce();
  return testSetup.captureCharFrame();
}

function expectOutputBounded(frame: string, outputPrefix: string) {
  const lines = frame.split("\n");
  const outputTitleIndex = lines.findIndex((line) => line.includes("Raw Output"));
  const outputBottomBorderIndex = lines.findIndex(
    (line, index) => index > outputTitleIndex && line.includes("└") && line.includes("┘"),
  );

  expect(outputTitleIndex).toBeGreaterThan(-1);
  expect(outputBottomBorderIndex).toBeGreaterThan(outputTitleIndex);
  expect(lines.slice(outputBottomBorderIndex + 1).join("\n")).toContain("Workspace status");
  expect(lines.slice(outputBottomBorderIndex + 1).join("\n")).not.toContain(outputPrefix);
}

async function expectOutputEndReachable(expectedLine: string) {
  const activeTestSetup = testSetup;
  if (!activeTestSetup) throw new Error("Expected output workspace renderer.");
  const keys = createMockKeys(activeTestSetup.renderer);
  keys.pressKey("END");
  await activeTestSetup.renderOnce();

  const frame = activeTestSetup.captureCharFrame();
  expect(frame).toContain(expectedLine);
  expect(frame).toContain("Workspace status");
}

afterEach(() => {
  act(() => {
    testSetup?.renderer.destroy();
  });
  useToolWorkspaceStore.setState({
    selectedHistoryRunId: null,
    selectedHistoryRun: null,
    isHistoricPreview: false,
  });
  testSetup = null;
});

test("keeps Custom authenticated output above the panel footer", async () => {
  configureWorkspace(
    createCustomAuthenticatedToolData(),
    createOutputLines("output-line-"),
  );

  expectOutputBounded(await renderWorkspaceBoundary(120, 40), "output-line-");
});

test("keeps Standard output bounded at compact terminal height", async () => {
  configureWorkspace(
    niktoCommandService.createInitialToolData("https://example.com"),
    createOutputLines("compact-line-"),
  );

  expectOutputBounded(await renderWorkspaceBoundary(100, 32), "compact-line-");
  await expectOutputEndReachable("compact-line-30");
});

test("keeps Custom authenticated output bounded at compact terminal height", async () => {
  configureWorkspace(
    createCustomAuthenticatedToolData(),
    createOutputLines("compact-auth-line-"),
  );

  expectOutputBounded(await renderWorkspaceBoundary(100, 36), "compact-auth-line-");
  await expectOutputEndReachable("compact-auth-line-30");
});

test("keeps historic Custom authenticated output bounded and scrollable", async () => {
  const toolData = createCustomAuthenticatedToolData();
  const command = niktoCommandService.buildCommand(toolData);
  const historyLines = createOutputLines("history-line-");
  configureWorkspace(toolData, ["live-line"]);
  useToolWorkspaceStore.setState({
    selectedHistoryRunId: "run-1",
    selectedHistoryRun: {
      id: "run-1",
      toolName: "nikto",
      command,
      commandSource: "generated",
      status: "success",
      startedAt: "2026-08-01T10:00:00.000Z",
      endedAt: "2026-08-01T10:01:00.000Z",
      exitCode: 0,
      logs: historyLines.map((line, index) => ({
        seq: index + 1,
        stream: "stdout",
        line,
        createdAt: "2026-08-01T10:00:00.000Z",
      })),
      artifacts: [],
    },
    isHistoricPreview: true,
  });

  const initialFrame = await renderWorkspaceBoundary(120, 40);
  expect(initialFrame).toContain("Raw Output (Historic Preview)");
  expect(initialFrame).not.toContain("live-line");

  const historicTestSetup = testSetup;
  if (!historicTestSetup) throw new Error("Expected historic workspace renderer.");
  const keys = createMockKeys(historicTestSetup.renderer);
  keys.pressKey("END");
  await historicTestSetup.renderOnce();

  const frame = historicTestSetup.captureCharFrame();
  expect(frame).toContain("history-line-30");
  expect(frame).toContain("Workspace status");
});

test("recomputes a bounded Custom authenticated output viewport after resize", async () => {
  configureWorkspace(
    createCustomAuthenticatedToolData(),
    createOutputLines("resize-line-"),
  );

  expect(await renderWorkspaceBoundary(120, 40)).toContain("Workspace status");
  const resizedTestSetup = testSetup;
  if (!resizedTestSetup) throw new Error("Expected resizable workspace renderer.");

  act(() => {
    resizedTestSetup.resize(100, 36);
  });
  await act(async () => {
    await resizedTestSetup.renderOnce();
  });

  expectOutputBounded(resizedTestSetup.captureCharFrame(), "resize-line-");
  await expectOutputEndReachable("resize-line-30");
});
