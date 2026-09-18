import { afterEach, describe, expect, it } from "bun:test";
import { testRender } from "@opentui/react/test-utils";
import { act } from "react";
import { useEntryShortcuts } from "../use-entry-shortcuts";

let testSetup: Awaited<ReturnType<typeof testRender>> | null = null;

function EntryShortcutHarness() {
  const { entryState, urlError, setUrlInput, submitUrlInput } = useEntryShortcuts({
    targets: [],
    onStartPentestForNewTarget: async () => {
      throw new Error("Invalid target URL: Target URL must use HTTP or HTTPS.");
    },
    onStartPentestForExistingTarget: () => {},
    onOpenSession: () => {},
  });

  return (
    <box flexDirection="column">
      <input
        value={entryState.urlInput}
        onChange={setUrlInput}
        onSubmit={submitUrlInput}
        focused={true}
      />
      <text>{urlError ?? "no-error"}</text>
    </box>
  );
}

afterEach(async () => {
  await act(async () => {
    testSetup?.renderer.destroy();
  });
  testSetup = null;
});

describe("useEntryShortcuts", () => {
  it("surfaces a rejected target URL submission", async () => {
    testSetup = await testRender(<EntryShortcutHarness />, {
      width: 80,
      height: 5,
    });

    await testSetup.renderOnce();
    await act(async () => {
      await testSetup!.mockInput.typeText("ftp://example.com");
      testSetup!.mockInput.pressEnter();
      await Promise.resolve();
    });
    await testSetup.renderOnce();

    expect(testSetup.captureCharFrame()).toContain(
      "Invalid target URL: Target URL must use HTTP or HTTPS.",
    );
  });
});
