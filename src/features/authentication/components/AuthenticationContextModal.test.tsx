import { afterEach, describe, expect, test } from "bun:test";
import { KeyEvent } from "@opentui/core";
import { testRender } from "@opentui/react/test-utils";
import { act } from "react";
import { AuthenticationContextModal } from "./AuthenticationContextModal";

let testSetup: Awaited<ReturnType<typeof testRender>> | null = null;

function renderModal(width: number) {
  return testRender(
    <AuthenticationContextModal
      targetUrl="http://localhost:4280"
      width={width}
      height={30}
      metadata={null}
      verificationUrlSuggestions={[
        "http://localhost:4280/",
        "http://localhost:4280/account",
        "http://localhost:4280/settings",
      ]}
      isSaving={false}
      isChecking={false}
      error="Save an authentication context before running Auth Check."
      onSave={async () => false}
      onClear={async () => {}}
      onRunAuthCheck={async () => false}
      onAcknowledgeInconclusive={() => false}
      onClose={() => {}}
    />,
    { width: width + 8, height: 34 },
  );
}

function pressPageDown() {
  testSetup?.renderer.keyInput.emit(
    "keypress",
    new KeyEvent({
      name: "pagedown",
      sequence: "\u001b[6~",
      raw: "\u001b[6~",
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

afterEach(async () => {
  await act(async () => {
    testSetup?.renderer.destroy();
  });
  testSetup = null;
});

describe("AuthenticationContextModal layout", () => {
  test("keeps compact modal copy readable without overlapping rows", async () => {
    testSetup = await renderModal(92);

    await testSetup.renderOnce();
    const frame = testSetup.captureCharFrame();

    expect(frame).toContain("Cookies: No cookies");
    expect(frame).toContain(
      "Ctrl+↑/↓ known route (3 suggestions, root included)",
    );
    expect(frame).toContain(
      "Save an authentication context before running Auth Check.",
    );

    pressPageDown();
    await testSetup.renderOnce();

    expect(testSetup.captureCharFrame()).toContain(
      "content stay out of metadata.",
    );
  });

  test("stacks actions before they can collide at narrow widths", async () => {
    testSetup = await renderModal(72);
    await testSetup.renderOnce();

    pressPageDown();
    await testSetup.renderOnce();

    expect(testSetup.captureCharFrame()).toContain(
      "Ctrl+K check | Ctrl+Y acknowledge | Ctrl+D clear",
    );
  });
});
