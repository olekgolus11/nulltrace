import { afterEach, describe, expect, test } from "bun:test";
import { testRender } from "@opentui/react/test-utils";
import { act, useEffect } from "react";
import { useDashboardShortcuts } from "../use-dashboard-shortcuts";

let testSetup: Awaited<ReturnType<typeof testRender>> | null = null;

function DashboardShortcutHarness() {
  const { dashboardState, setActivePanel } = useDashboardShortcuts({
    onBack: () => {},
    onSelectTool: () => {},
    sitemapCount: 0,
    onCycleSitemapDepth: () => {},
    onCycleSitemapProvenance: () => {},
    onPauseOrResumeSitemapCrawl: () => {},
    onRetrySitemapFailures: () => {},
    onRestartSitemapCrawl: () => {},
    isSitemapAuthRenewalRequired: true,
    findings: [],
    onSetFindingReviewStatus: () => {},
    conversations: [],
    activeConversationId: null,
    isConversationNavigationDisabled: false,
    onSelectConversation: () => {},
    onCreateConversation: () => {},
    onArchiveActiveConversation: () => {},
  });

  useEffect(() => {
    setActivePanel("sitemap");
  }, []);

  return (
    <text>
      {dashboardState.activePanel}:{dashboardState.isAuthenticationContextOpen
        ? "auth-open"
        : "auth-closed"}
    </text>
  );
}

afterEach(async () => {
  await act(async () => {
    testSetup?.renderer.destroy();
  });
  testSetup = null;
});

describe("useDashboardShortcuts", () => {
  test.each([
    ["pause/resume", " "],
    ["retry", "r"],
    ["restart", "R"],
  ])(
    "opens authentication renewal for a locked crawl's %s key",
    async (_, key) => {
      testSetup = await testRender(<DashboardShortcutHarness />, {
        width: 60,
        height: 10,
      });

      await testSetup.renderOnce();
      expect(testSetup.captureCharFrame()).toContain("sitemap:auth-closed");

      await act(async () => {
        testSetup!.mockInput.pressKey(key);
      });
      await testSetup.renderOnce();
      expect(testSetup.captureCharFrame()).toContain("sitemap:auth-open");
    },
  );
});
