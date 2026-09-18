import { afterEach, expect, test } from "bun:test";
import { MouseButtons } from "@opentui/core/testing";
import { testRender } from "@opentui/react/test-utils";
import { act } from "react";
import { curlCommandService } from "../../services/curl-command.service";
import { CurlToolData } from "../../types/curl.types";
import { useToolWorkspaceStore } from "../../../shared/store/tool-workspace.store";
import { CurlForm } from "../CurlForm";
import { CurlWorkspace } from "../CurlWorkspace";

let testSetup: Awaited<ReturnType<typeof testRender>> | null = null;

afterEach(() => {
  act(() => {
    testSetup?.renderer.destroy();
  });
  useToolWorkspaceStore.setState({
    toolName: null,
    toolData: null,
    selectedHistoryRun: null,
    isHistoricPreview: false,
  });
  testSetup = null;
});

test("renders Text and JSON request controls without session auth by default", async () => {
  const toolData = curlCommandService.createInitialToolData("https://example.com/api");
  testSetup = await testRender(
    <CurlForm
      toolData={toolData}
      focused={true}
      onFieldChange={() => {}}
      onSelectField={() => {}}
      onCycleMethod={() => {}}
      onCycleBodyMode={() => {}}
      onToggleAuthenticatedContext={() => {}}
    />,
    { width: 110, height: 16 },
  );

  await testSetup.renderOnce();
  const frame = testSetup.captureCharFrame();
  expect(frame).toContain("GET");
  expect(frame).toContain("Target URL");
  expect(frame).toContain("Headers");
  expect(frame).toContain("[Text]  JSON");
  expect(frame).toContain("Body");
  expect(frame).not.toContain("Session auth");
});

test("shows accepted session authentication as an explicit opt-in", async () => {
  const toolData = curlCommandService.setAuthenticationAvailability(
    curlCommandService.createInitialToolData("https://example.com/api"),
    "https://example.com",
  );
  testSetup = await testRender(
    <CurlForm
      toolData={toolData}
      focused={true}
      onFieldChange={() => {}}
      onSelectField={() => {}}
      onCycleMethod={() => {}}
      onCycleBodyMode={() => {}}
      onToggleAuthenticatedContext={() => {}}
    />,
    { width: 110, height: 16 },
  );

  await testSetup.renderOnce();
  const frame = testSetup.captureCharFrame();
  expect(frame).toContain("Session auth");
  expect(frame).toContain("enabled  [disabled]");
  expect(frame).toContain("https://example.com");
});

test("renders the complete cURL workspace", async () => {
  const toolData = curlCommandService.createInitialToolData("https://example.com/api");
  const command = curlCommandService.buildCommand(toolData);
  act(() => {
    useToolWorkspaceStore.setState({
      toolName: "curl",
      targetUrl: "https://example.com/api",
      toolData,
      commandInput: command,
      generatedCommand: command,
      activePanel: "form",
    });
  });
  testSetup = await testRender(<CurlWorkspace />, { width: 120, height: 40 });

  await testSetup.renderOnce();
  const frame = testSetup.captureCharFrame();
  expect(frame).toContain("cURL Request Controls");
  expect(frame).toContain("Command");
  expect(frame).toContain("Bounded Response");
  expect(frame).toContain("Response limit: 2 MiB");
});

test("clicking a form control focuses its panel and ignores right clicks", async () => {
  const toolData = curlCommandService.createInitialToolData("https://example.com/api");
  const command = curlCommandService.buildCommand(toolData);
  act(() => {
    useToolWorkspaceStore.setState({
      toolName: "curl",
      targetUrl: "https://example.com/api",
      toolData,
      commandInput: command,
      generatedCommand: command,
      activePanel: "command",
    });
  });
  testSetup = await testRender(<CurlWorkspace />, { width: 120, height: 40 });

  await testSetup.renderOnce();
  await act(async () => {
    await testSetup!.mockMouse.click(30, 2, MouseButtons.RIGHT);
  });
  expect(useToolWorkspaceStore.getState().activePanel).toBe("command");
  expect((useToolWorkspaceStore.getState().toolData as CurlToolData).form.method).toBe("GET");

  await act(async () => {
    await testSetup!.mockMouse.click(30, 2, MouseButtons.LEFT);
  });
  expect(useToolWorkspaceStore.getState().activePanel).toBe("form");
  expect((useToolWorkspaceStore.getState().toolData as CurlToolData).form.method).toBe("HEAD");
});
