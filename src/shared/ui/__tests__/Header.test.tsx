import { afterEach, expect, test } from "bun:test";
import { testRender } from "@opentui/react/test-utils";
import { act } from "react";
import { Header } from "../Header";

let testSetup: Awaited<ReturnType<typeof testRender>> | null = null;

afterEach(async () => {
  await act(async () => {
    testSetup?.renderer.destroy();
  });
  testSetup = null;
});

test("shows authentication required when a verified context stops working", async () => {
  testSetup = await testRender(
    <Header
      targetUrl="https://example.com"
      authenticationContext={{
        origin: "https://example.com",
        cookieCount: 1,
        headerNames: [],
        storageMode: "secure",
        importSource: "manual",
        updatedAt: "2026-07-15T10:00:00.000Z",
        authCheck: {
          status: "verified",
          verificationUrl: "https://example.com/account",
          checkedAt: "2026-07-15T10:01:00.000Z",
          acknowledgedAt: null,
          isProceedAllowed: true,
          summary: "Authenticated behavior differs from public behavior.",
          signals: null,
        },
      }}
      authenticatedSitemapStatus={{
        sessionId: "session-1",
        targetId: "target-1",
        status: "authentication_required",
        startedAt: "2026-07-15T10:01:00.000Z",
        completedAt: null,
        pausedAt: "2026-07-15T10:02:00.000Z",
        failedAt: null,
        errorMessage: "Authentication required",
        updatedAt: "2026-07-15T10:02:00.000Z",
      }}
    />,
    { width: 160, height: 3 },
  );

  await testSetup.renderOnce();
  const frame = testSetup.captureCharFrame();

  expect(frame).toContain("Auth: authentication required");
  expect(frame).not.toContain("Auth: verified");
});
