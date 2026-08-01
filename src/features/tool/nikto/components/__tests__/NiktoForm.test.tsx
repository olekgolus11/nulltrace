import { afterEach, expect, test } from "bun:test";
import { testRender } from "@opentui/react/test-utils";
import { act } from "react";
import { useToolWorkspaceStore } from "../../../shared/store/tool-workspace.store";
import { niktoCommandService } from "../../services/nikto-command.service";
import { NiktoForm } from "../NiktoForm";
import { NiktoWorkspace } from "../NiktoWorkspace";

let testSetup: Awaited<ReturnType<typeof testRender>> | null = null;

afterEach(() => {
  act(() => {
    testSetup?.renderer.destroy();
  });
  testSetup = null;
});

test("uses the shared Mode language for Standard scans", async () => {
  const toolData = niktoCommandService.createInitialToolData("https://example.com");

  testSetup = await testRender(
    <NiktoForm
      form={toolData.form}
      selectedField={toolData.selectedField}
      focused
      onFieldChange={() => {}}
      onProfileChange={() => {}}
      onToggleTuning={() => {}}
      authAvailable={false}
      authOrigin={null}
      onToggleAuthenticatedContext={() => {}}
    />,
    { width: 100, height: 18 },
  );
  await testSetup.renderOnce();

  const frame = testSetup.captureCharFrame();
  expect(frame).toContain("Mode: Standard");
  expect(frame).toContain("press Left/Right to switch modes");
  expect(frame).not.toContain("Profile");
});

test("renders Custom tuning as separate Nmap-style flag rows", async () => {
  const toolData = niktoCommandService.setProfile(
    niktoCommandService.createInitialToolData("https://example.com"),
    "custom",
  );

  testSetup = await testRender(
    <NiktoForm
      form={toolData.form}
      selectedField={toolData.selectedField}
      focused
      onFieldChange={() => {}}
      onProfileChange={() => {}}
      onToggleTuning={() => {}}
      authAvailable={false}
      authOrigin={null}
      onToggleAuthenticatedContext={() => {}}
    />,
    { width: 100, height: 20 },
  );
  await testSetup.renderOnce();

  const lines = testSetup.captureCharFrame().split("\n");
  const expectedFlags = [
    "[x] Misconfiguration / defaults (-Tuning 2)",
    "[x] Information disclosure (-Tuning 3)",
    "[ ] Denial of service (-Tuning 6) [CONFIRM]",
    "[x] Software identification (-Tuning b)",
  ] as const;
  const flagLineIndexes = expectedFlags.map((flag) =>
    lines.findIndex((line) => line.includes(flag)),
  );

  expect(lines.some((line) => line.includes("Flags"))).toBe(true);
  expect(flagLineIndexes.every((lineIndex) => lineIndex >= 0)).toBe(true);
  expect(new Set(flagLineIndexes).size).toBe(expectedFlags.length);
});

test("keeps Custom flags and runtime controls visible in the complete workspace", async () => {
  const toolData = niktoCommandService.setProfile(
    niktoCommandService.createInitialToolData("https://example.com"),
    "custom",
  );
  const command = niktoCommandService.buildCommand(toolData);
  useToolWorkspaceStore.setState({
    toolName: "nikto",
    targetUrl: "https://example.com",
    toolData,
    commandInput: command,
    generatedCommand: command,
    activePanel: "form",
  });

  testSetup = await testRender(<NiktoWorkspace />, {
    width: 120,
    height: 40,
  });
  await testSetup.renderOnce();

  const frame = testSetup.captureCharFrame();
  expect(frame).toContain("Denial of service (-Tuning 6) [CONFIRM]");
  expect(frame).toContain("Max run (sec)");
  expect(frame).toContain("Raw Output");
});

test("shows explicit public and authenticated execution choices without secrets", async () => {
  let toolData = niktoCommandService.createInitialToolData("https://example.com");
  toolData = niktoCommandService.setAuthenticationAvailability(
    toolData,
    "https://example.com",
  );
  useToolWorkspaceStore.setState({
    toolName: "nikto",
    targetUrl: "https://example.com",
    toolData,
    commandInput: niktoCommandService.buildCommand(toolData),
    generatedCommand: niktoCommandService.buildCommand(toolData),
    activePanel: "form",
  });

  testSetup = await testRender(<NiktoWorkspace />, {
    width: 120,
    height: 40,
  });
  await testSetup.renderOnce();

  const frame = testSetup.captureCharFrame();
  expect(frame).toContain("Session auth");
  expect(frame).toContain("enabled  [disabled]");
  expect(frame).toContain("https://example.com");
  expect(frame).not.toContain("Cookie:");
  expect(frame).not.toContain("Authorization:");
});

test("redacts manually typed authentication values from command preview", async () => {
  const toolData = niktoCommandService.createInitialToolData("https://example.com");
  useToolWorkspaceStore.setState({
    toolName: "nikto",
    targetUrl: "https://example.com",
    toolData,
    commandInput: "nikto -h https://example.com -id admin:preview-secret -Tuning x6",
    generatedCommand: niktoCommandService.buildCommand(toolData),
    activePanel: "command",
  });

  testSetup = await testRender(<NiktoWorkspace />, {
    width: 120,
    height: 40,
  });
  await testSetup.renderOnce();

  const frame = testSetup.captureCharFrame();
  expect(frame).toContain("[redacted]");
  expect(frame).not.toContain("preview-secret");
});
