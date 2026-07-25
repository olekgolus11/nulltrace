import { afterEach, describe, expect, test } from "bun:test";
import { testRender } from "@opentui/react/test-utils";
import { act } from "react";
import { PageInspectionPermissionModal } from "../PageInspectionPermissionModal";

let testSetup: Awaited<ReturnType<typeof testRender>> | null = null;

afterEach(async () => {
  await act(async () => {
    testSetup?.renderer.destroy();
  });
  testSetup = null;
});

describe("PageInspectionPermissionModal", () => {
  test("shows the three session inspection modes", async () => {
    testSetup = await testRender(
      <PageInspectionPermissionModal
        width={88}
        height={18}
        status={{
          isAllowed: false,
          mode: "none",
          status: "ready",
        }}
        hasAcceptedAuthenticationContext
        onAllowPublic={() => {}}
        onAllowAuthenticated={() => {}}
        onNoInspection={() => {}}
        onClose={() => {}}
      />,
      { width: 100, height: 24 },
    );

    await testSetup.renderOnce();
    const frame = testSetup.captureCharFrame();

    expect(frame).toContain("Allow public inspection");
    expect(frame).toContain("Allow auth inspection");
    expect(frame).toContain("No inspection");
    expect(frame).toContain("Choose one session-wide mode.");
  });

  test("does not select auth mode without an accepted context", async () => {
    let authenticatedSelections = 0;
    testSetup = await testRender(
      <PageInspectionPermissionModal
        width={88}
        height={18}
        status={{
          isAllowed: true,
          mode: "public",
          status: "ready",
        }}
        hasAcceptedAuthenticationContext={false}
        onAllowPublic={() => {}}
        onAllowAuthenticated={() => {
          authenticatedSelections += 1;
        }}
        onNoInspection={() => {}}
        onClose={() => {}}
      />,
      { width: 100, height: 24 },
    );

    await testSetup.renderOnce();
    expect(testSetup.captureCharFrame()).toContain("Allow auth inspection");
    expect(testSetup.captureCharFrame()).toContain(
      "Auth inspection requires an accepted Authentication Context.",
    );

    await act(async () => {
      testSetup!.mockInput.pressKey("a");
    });

    expect(authenticatedSelections).toBe(0);
  });
});
