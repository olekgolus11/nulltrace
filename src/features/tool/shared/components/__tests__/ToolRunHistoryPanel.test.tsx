import { afterEach, expect, test } from "bun:test";
import { createMockMouse } from "@opentui/core/testing";
import { testRender } from "@opentui/react/test-utils";
import { act } from "react";
import { ToolRunHistoryPanel } from "../ToolRunHistoryPanel";

let testSetup: Awaited<ReturnType<typeof testRender>> | null = null;

afterEach(() => {
  act(() => testSetup?.renderer.destroy());
  testSetup = null;
});

test("left-clicking a history row focuses its panel before selecting the run", async () => {
  const actions: string[] = [];
  testSetup = await testRender(
    <ToolRunHistoryPanel
      runs={[{
        id: "run-1",
        toolName: "nmap",
        command: "nmap example.test",
        commandSource: "manual",
        status: "success",
        startedAt: "2026-09-07T10:00:00Z",
        endedAt: "2026-09-07T10:01:00Z",
        exitCode: 0,
      }]}
      selectedRunId={null}
      focused={false}
      scrollRef={{ current: null }}
      onMouseDown={() => actions.push("focus")}
      onSelectRun={(id) => actions.push(id)}
    />,
    { width: 50, height: 12 },
  );
  await testSetup.renderOnce();
  const lines = testSetup.captureCharFrame().split("\n");
  const row = lines.findIndex((line) => line.includes("nmap example.test"));
  expect(row).toBeGreaterThanOrEqual(0);
  const column = lines[row]!.indexOf("nmap");
  const mouse = createMockMouse(testSetup.renderer);
  await mouse.click(column, row);
  expect(actions).toEqual(["focus", "run-1"]);
  actions.length = 0;
  await mouse.click(column, row, 2);
  expect(actions).not.toContain("run-1");
});
