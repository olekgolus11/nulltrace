import { afterEach, expect, test } from "bun:test";
import { createMockMouse, MouseButtons } from "@opentui/core/testing";
import { testRender } from "@opentui/react/test-utils";
import { act } from "react";
import { ActionDraftList } from "../ActionDraftList";

let testSetup: Awaited<ReturnType<typeof testRender>> | null = null;

afterEach(() => {
  act(() => testSetup?.renderer.destroy());
  testSetup = null;
});

test("left-clicking a draft focuses its panel before applying it", async () => {
  const actions: string[] = [];
  testSetup = await testRender(
    <ActionDraftList
      drafts={[
        {
          id: "draft-1",
          sessionId: "session-1",
          opencodeConversationId: "conversation-1",
          targetTool: "nmap",
          title: "Scan common ports",
          summary: "Run a focused scan.",
          payload: {},
          status: "draft",
          createdAt: "2026-09-18T10:00:00Z",
          updatedAt: "2026-09-18T10:00:00Z",
        },
      ]}
      emptyLabel="No drafts."
      onMouseDown={() => actions.push("focus")}
      onApplyDraft={(draft) => actions.push(draft.id)}
    />,
    { width: 50, height: 5 },
  );
  await testSetup.renderOnce();
  const frame = testSetup.captureCharFrame().split("\n");
  const row = frame.findIndex((line) => line.includes("Scan common ports"));
  const column = frame[row]!.indexOf("Scan common ports");
  const mouse = createMockMouse(testSetup.renderer);

  await mouse.click(column, row);
  expect(actions).toEqual(["focus", "draft-1"]);

  actions.length = 0;
  await mouse.click(column, row, MouseButtons.RIGHT);
  expect(actions).toEqual([]);
});
