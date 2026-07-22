import { afterEach, describe, expect, test } from "bun:test";
import { KeyEvent } from "@opentui/core";
import { testRender } from "@opentui/react/test-utils";
import { act } from "react";
import { AuthenticationContextModal } from "../AuthenticationContextModal";
import { AuthenticatedRequestContextInput } from "../../model/authenticated-request-context.types";

let testSetup: Awaited<ReturnType<typeof testRender>> | null = null;
const temporaryFiles: string[] = [];

function renderModal(
  width: number,
  callbacks: {
    onSave?: (input: AuthenticatedRequestContextInput) => Promise<boolean>;
    onClear?: () => Promise<void>;
    onRunAuthCheck?: (verificationUrl: string) => Promise<boolean>;
  } = {},
) {
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
      onSave={callbacks.onSave ?? (async () => false)}
      onClear={callbacks.onClear ?? (async () => {})}
      onRunAuthCheck={callbacks.onRunAuthCheck ?? (async () => false)}
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
  await Promise.all(temporaryFiles.splice(0).map((path) => Bun.file(path).delete()));
  testSetup = null;
});

describe("AuthenticationContextModal layout", () => {
  test("keeps compact modal copy readable without overlapping rows", async () => {
    testSetup = await renderModal(92);

    await testSetup.renderOnce();
    const frame = testSetup.captureCharFrame();

    expect(frame).toContain("Cookies: No cookies");
    expect(frame).toContain("Ctrl+↑/↓ known route (3 suggestions, root included)");
    expect(frame).toContain("Save an authentication context before running Auth Check.");

    pressPageDown();
    await testSetup.renderOnce();

    expect(testSetup.captureCharFrame()).toContain("content stay out of metadata.");
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

  test("uses the imported curl route for verification after saving", async () => {
    let savedContext: AuthenticatedRequestContextInput | null = null;
    let checkedUrl = "";
    testSetup = await renderModal(92, {
      onSave: async (input) => {
        savedContext = input;
        return true;
      },
      onRunAuthCheck: async (verificationUrl) => {
        checkedUrl = verificationUrl;
        return true;
      },
    });
    await testSetup.renderOnce();

    await act(async () => {
      testSetup!.mockInput.pressKey("u", { ctrl: true });
    });
    await testSetup.renderOnce();
    await act(async () => {
      await testSetup!.mockInput.typeText(
        "curl 'http://localhost:4280/account' -b 'session=secret'",
      );
    });
    await testSetup.renderOnce();
    await act(async () => {
      testSetup!.mockInput.pressKey("s", { ctrl: true });
    });
    await testSetup.renderOnce();

    expect(testSetup.captureCharFrame()).toContain("http://localhost:4280/account");

    await act(async () => {
      testSetup!.mockInput.pressKey("s", { ctrl: true });
      await Promise.resolve();
    });
    await testSetup.renderOnce();
    expect(savedContext).toMatchObject({
      origin: "http://localhost:4280",
      cookies: "session=secret",
    });
    expect(testSetup.captureCharFrame()).toContain("Active: redacted import review");
    expect(testSetup.captureCharFrame()).not.toContain("Active: manual");

    await act(async () => {
      testSetup!.mockInput.pressKey("k", { ctrl: true });
      await Promise.resolve();
    });
    expect(checkedUrl).toBe("http://localhost:4280/account");

    await act(async () => {
      testSetup!.mockInput.pressKey("d", { ctrl: true });
      await Promise.resolve();
    });
    await testSetup.renderOnce();
    expect(testSetup.captureCharFrame()).toContain("Active: manual");
  });

  test("uses the selected HAR request URL for verification", async () => {
    const harPath = `/tmp/nulltrace-auth-modal-${crypto.randomUUID()}.har`;
    temporaryFiles.push(harPath);
    await Bun.write(
      harPath,
      JSON.stringify({
        log: {
          entries: [
            {
              request: {
                method: "GET",
                url: "http://localhost:4280/account?view=summary",
                headers: [{ name: "Authorization", value: "Bearer secret" }],
                cookies: [],
              },
            },
          ],
        },
      }),
    );
    let checkedUrl = "";
    testSetup = await renderModal(92, {
      onRunAuthCheck: async (verificationUrl) => {
        checkedUrl = verificationUrl;
        return true;
      },
    });
    await testSetup.renderOnce();

    await act(async () => {
      testSetup!.mockInput.pressKey("r", { ctrl: true });
    });
    await testSetup.renderOnce();
    await act(async () => {
      await testSetup!.mockInput.typeText(harPath);
    });
    await testSetup.renderOnce();
    await act(async () => {
      testSetup!.mockInput.pressKey("s", { ctrl: true });
      await Bun.sleep(10);
    });
    await testSetup.renderOnce();
    await act(async () => {
      testSetup!.mockInput.pressKey("s", { ctrl: true });
    });
    await testSetup.renderOnce();

    expect(testSetup.captureCharFrame()).toContain("http://localhost:4280/account?view=summary");

    await act(async () => {
      testSetup!.mockInput.pressKey("k", { ctrl: true });
      await Promise.resolve();
    });
    expect(checkedUrl).toBe("http://localhost:4280/account?view=summary");
  });
});
