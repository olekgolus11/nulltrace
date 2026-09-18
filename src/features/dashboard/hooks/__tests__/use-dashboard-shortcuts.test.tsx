import { afterEach, describe, expect, test } from "bun:test";
import { testRender } from "@opentui/react/test-utils";
import { act, useEffect, useState } from "react";
import { useDashboardShortcuts } from "../use-dashboard-shortcuts";

let testSetup: Awaited<ReturnType<typeof testRender>> | null = null;
let restartCallCount = 0;

function DashboardShortcutHarness({
  isLocked = true,
  sitemapCount = 0,
  shrinkWhenFindings = false,
  focusFindingsAfterSitemapSelection = false,
}: {
  isLocked?: boolean;
  sitemapCount?: number;
  shrinkWhenFindings?: boolean;
  focusFindingsAfterSitemapSelection?: boolean;
}) {
  const [currentSitemapCount, setCurrentSitemapCount] = useState(sitemapCount);
  const { dashboardState, setActivePanel, selectSitemapEntry } = useDashboardShortcuts({
    onBack: () => {},
    onSelectTool: () => {},
    sitemapCount: currentSitemapCount,
    onCycleSitemapDepth: () => {},
    onCycleSitemapProvenance: () => {},
    onPauseOrResumeSitemapCrawl: () => {},
    onRestartSitemapCrawl: () => {
      restartCallCount += 1;
    },
    isSitemapAuthRenewalRequired: isLocked,
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
    if (sitemapCount === 0) {
      setActivePanel("sitemap");
    }
  }, [sitemapCount]);

  useEffect(() => {
    if (shrinkWhenFindings && dashboardState.activePanel === "findings") {
      setCurrentSitemapCount(1);
    }
  }, [dashboardState.activePanel, shrinkWhenFindings]);

  useEffect(() => {
    if (focusFindingsAfterSitemapSelection && dashboardState.selectedSitemapItem === 2) {
      setActivePanel("findings");
    }
  }, [dashboardState.selectedSitemapItem, focusFindingsAfterSitemapSelection]);

  return (
    <box
      onMouseDown={(event) => {
        if (event.button === 0) {
          selectSitemapEntry(2);
        }
      }}
    >
      <text>
        {dashboardState.activePanel}:{dashboardState.selectedSitemapItem}:
        {dashboardState.isAuthenticationContextOpen ? "auth-open" : "auth-closed"}
        :{dashboardState.isPageInspectionOpen ? "inspection-open" : "inspection-closed"}
        :{dashboardState.isReportExportOpen ? "report-open" : "report-closed"}
      </text>
    </box>
  );
}

afterEach(async () => {
  await act(async () => {
    testSetup?.renderer.destroy();
  });
  testSetup = null;
  restartCallCount = 0;
});

describe("useDashboardShortcuts", () => {
  test.each([
    ["pause/resume", " "],
    ["restart", "CTRL_R"],
  ])("opens authentication renewal for a locked crawl's %s key", async (_, key) => {
    testSetup = await testRender(<DashboardShortcutHarness />, {
      width: 60,
      height: 10,
    });

    await testSetup.renderOnce();
    expect(testSetup.captureCharFrame()).toContain("sitemap:0:auth-closed");

    await act(async () => {
      if (key === "CTRL_R") {
        testSetup!.mockInput.pressKey("r", { ctrl: true });
      } else {
        testSetup!.mockInput.pressKey(key);
      }
    });
    await testSetup.renderOnce();
    expect(testSetup.captureCharFrame()).toContain("sitemap:0:auth-open");
  });

  test("uses Ctrl+R for restart and leaves plain r unbound", async () => {
    testSetup = await testRender(<DashboardShortcutHarness isLocked={false} />, {
      width: 60,
      height: 10,
    });

    await testSetup.renderOnce();
    await act(async () => {
      testSetup!.mockInput.pressKey("r");
    });
    expect(restartCallCount).toBe(0);

    await act(async () => {
      testSetup!.mockInput.pressKey("r", { ctrl: true });
    });
    expect(restartCallCount).toBe(1);
  });

  test("opens Page Inspection with Ctrl+P without cycling the active panel", async () => {
    testSetup = await testRender(<DashboardShortcutHarness />, {
      width: 60,
      height: 10,
    });

    await testSetup.renderOnce();
    await act(async () => {
      testSetup!.mockInput.pressKey("p", { ctrl: true });
    });
    await testSetup.renderOnce();

    expect(testSetup.captureCharFrame()).toContain("sitemap:0:auth-closed:inspection-open");
  });

  test("opens report export with Ctrl+E without cycling the active panel", async () => {
    testSetup = await testRender(<DashboardShortcutHarness />, {
      width: 60,
      height: 10,
    });

    await testSetup.renderOnce();
    await act(async () => {
      testSetup!.mockInput.pressKey("e", { ctrl: true });
    });
    await testSetup.renderOnce();

    expect(testSetup.captureCharFrame()).toContain(
      "sitemap:0:auth-closed:inspection-closed:report-open",
    );
  });

  test("leaves Ctrl+number unbound", async () => {
    testSetup = await testRender(<DashboardShortcutHarness />, {
      width: 60,
      height: 10,
    });

    await testSetup.renderOnce();
    expect(testSetup.captureCharFrame()).toContain("sitemap:0:");

    await act(async () => {
      testSetup!.mockInput.pressKey("3", { ctrl: true });
    });
    await testSetup.renderOnce();

    expect(testSetup.captureCharFrame()).toContain("sitemap:0:");
  });

  test("mouse selection focuses Sitemap and keyboard navigation continues from it", async () => {
    testSetup = await testRender(<DashboardShortcutHarness sitemapCount={4} />, {
      width: 60,
      height: 10,
    });

    await testSetup.renderOnce();
    expect(testSetup.captureCharFrame()).toContain("chat:0:");

    await act(async () => {
      await testSetup!.mockMouse.pressDown(1, 0);
    });
    await testSetup.renderOnce();
    await act(async () => {
      await testSetup!.mockMouse.release(1, 0);
    });
    await act(async () => {
      await testSetup!.renderOnce();
    });
    expect(testSetup.captureCharFrame()).toContain("sitemap:2:");

    await act(async () => {
      testSetup!.mockInput.pressArrow("down");
    });
    await testSetup.renderOnce();
    expect(testSetup.captureCharFrame()).toContain("sitemap:3:");
  });

  test("clamps a stale sitemap selection without changing the active panel", async () => {
    testSetup = await testRender(
      <DashboardShortcutHarness
        sitemapCount={4}
        shrinkWhenFindings={true}
        focusFindingsAfterSitemapSelection={true}
      />,
      {
        width: 60,
        height: 10,
      },
    );

    await testSetup.renderOnce();
    await act(async () => {
      await testSetup!.mockMouse.pressDown(1, 0);
    });
    await testSetup.renderOnce();
    await act(async () => {
      await testSetup!.mockMouse.release(1, 0);
    });
    await testSetup.renderOnce();
    await testSetup.renderOnce();

    expect(testSetup.captureCharFrame()).toContain("findings:0:");
  });
});
