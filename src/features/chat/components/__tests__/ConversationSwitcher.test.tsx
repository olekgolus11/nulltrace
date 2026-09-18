import { afterEach, expect, test } from "bun:test";
import { createMockMouse, MouseButtons } from "@opentui/core/testing";
import { testRender } from "@opentui/react/test-utils";
import { act } from "react";
import { ConversationSwitcher } from "../ConversationSwitcher";

let testSetup: Awaited<ReturnType<typeof testRender>> | null = null;

afterEach(() => {
  act(() => testSetup?.renderer.destroy());
  testSetup = null;
});

test("left-clicking a conversation focuses its panel before selecting it", async () => {
  const actions: string[] = [];
  testSetup = await testRender(
    <ConversationSwitcher
      conversations={[
        {
          attachment: {
            sessionId: "session-1",
            opencodeConversationId: "conversation-1",
            isDefault: true,
            archivedAt: null,
            createdAt: "2026-09-18T10:00:00Z",
          },
          title: "First conversation",
        },
      ]}
      activeConversationId={null}
      availableWidth={60}
      isDisabled={false}
      onMouseDown={() => actions.push("focus")}
      onSelectConversation={(id) => actions.push(id)}
      onCreateConversation={() => {}}
      onArchiveConversation={() => {}}
    />,
    { width: 60, height: 3 },
  );
  await testSetup.renderOnce();
  const frame = testSetup.captureCharFrame().split("\n");
  const row = frame.findIndex((line) => line.includes("First"));
  const column = frame[row]!.indexOf("First");
  const mouse = createMockMouse(testSetup.renderer);

  await mouse.click(column, row);
  expect(actions).toEqual(["focus", "conversation-1"]);

  actions.length = 0;
  await mouse.click(column, row, MouseButtons.RIGHT);
  expect(actions).toEqual([]);
});
