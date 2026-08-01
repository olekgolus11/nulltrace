import { afterEach, expect, test } from "bun:test";
import { testRender } from "@opentui/react/test-utils";
import { act } from "react";
import { ShortcutHints } from "../ShortcutHints";
import { StatusBar } from "../StatusBar";

let testSetup: Awaited<ReturnType<typeof testRender>> | null = null;

afterEach(async () => {
  await act(async () => {
    testSetup?.renderer.destroy();
  });
  testSetup = null;
});

test("keeps the active panel visible on one compact row", async () => {
  testSetup = await testRender(
    <StatusBar
      activePanel="findings"
      panels={[
        { id: "sitemap", label: "SITEMAP" },
        { id: "findings", label: "FINDINGS" },
        { id: "chat", label: "AI CHAT" },
      ]}
      hints={[
        { key: "Tab/Shift+Tab", label: "switch" },
        { key: "Ctrl+1-3", label: "jump" },
        { key: "↑↓", label: "navigate" },
        { key: "ESC", label: "back" },
      ]}
    />,
    { width: 40, height: 2 },
  );

  await testSetup.renderOnce();
  const [statusRow, nextRow] = testSetup.captureCharFrame().split("\n");

  expect(statusRow).toContain("…");
  expect(statusRow).toContain("[2 FINDINGS]");
  expect(statusRow).not.toContain("[1 SITEMAP]");
  expect(statusRow).not.toContain("[3 AI CHAT]");
  expect(Bun.stringWidth(statusRow ?? "")).toBeLessThanOrEqual(40);
  expect(nextRow?.trim()).toBe("");
});

test("compacts Tool-style inputs around the active panel", async () => {
  testSetup = await testRender(
    <StatusBar
      activePanel="history"
      panels={[
        { id: "form", label: "FORM" },
        { id: "drafts", label: "DRAFTS" },
        { id: "output", label: "OUTPUT" },
        { id: "chat", label: "AI CHAT" },
        { id: "notes", label: "NOTES" },
        { id: "history", label: "HISTORY" },
      ]}
      hints={[
        { key: "Tab/Shift+Tab", label: "switch" },
        { key: "Ctrl+1-6", label: "jump" },
        { key: "Ctrl+R", label: "run" },
      ]}
    />,
    { width: 60, height: 2 },
  );

  await testSetup.renderOnce();
  const statusRow = testSetup.captureCharFrame().split("\n")[0] ?? "";

  expect(statusRow).toContain("…");
  expect(statusRow).toContain("[6 HISTORY]");
  expect(statusRow).not.toContain("[1 FORM]");
  expect(statusRow).not.toContain("[5 NOTES]");
  expect(Bun.stringWidth(statusRow)).toBeLessThanOrEqual(60);
});

test("keeps ShortcutHints default rendering unchanged for Entry", async () => {
  testSetup = await testRender(
    <ShortcutHints
      hints={[
        { key: "Ctrl+Q", label: "quit" },
        { key: "Enter", label: "select" },
      ]}
    />,
    { width: 40, height: 1 },
  );

  await testSetup.renderOnce();

  expect(testSetup.captureCharFrame()).toContain("Ctrl+Q quit | Enter select");
  expect(testSetup.captureCharFrame()).not.toContain("…");
});
