import { ScrollBoxRenderable } from "@opentui/core";
import { theme } from "../../../app/theme/theme";
import { ChatWindow } from "../../chat/components/ChatWindow";
import { SessionFindingRecord } from "../../finding/model/finding.types";
import { SitemapTree } from "../../sitemap/components/SitemapTree";
import { FindingList } from "../../finding/components/FindingList";
import { mockSitemapTree, mockChatMessages } from "../data/dashboard.mock";
import { tools } from "../data/tool-catalog";
import { dashboardPanels } from "../model/dashboard.state";
import { DashboardPanelId, DashboardState } from "../model/dashboard.types";
import { UseDashboardLayoutResult } from "../model/dashboard.types";
import { DashboardPanel } from "./DashboardPanel";
import { ToolList } from "./ToolList";
import { getPanelDisplayNumber } from "../../../shared/model/panel-navigation";

const dashboardScrollbarTrackOptions = {
  backgroundColor: theme.border.muted,
  foregroundColor: theme.text.secondary,
} as const;

export const LeftDashboardPanel = ({
  dashboardState,
  findings,
  layout,
  sitemapScrollRef,
  findingsScrollRef,
  setActivePanel,
  selectFinding,
}: {
  dashboardState: DashboardState;
  findings: SessionFindingRecord[];
  layout: UseDashboardLayoutResult;
  sitemapScrollRef: React.RefObject<ScrollBoxRenderable | null>;
  findingsScrollRef: React.RefObject<ScrollBoxRenderable | null>;
  setActivePanel: (panel: DashboardPanelId) => void;
  selectFinding: (index: number) => void;
}) => {
  return (
    <box
      width={layout.leftPanelWidth}
      height={layout.contentHeight}
      flexDirection="column"
    >
      <DashboardPanel
        title="Sitemap"
        panelNumber={getPanelDisplayNumber(dashboardPanels, "sitemap")}
        height={layout.leftPanelTopHeight}
        focused={dashboardState.activePanel === "sitemap"}
        paddingBottom={0}
        onMouseDown={() => setActivePanel("sitemap")}
      >
        <scrollbox
          ref={sitemapScrollRef}
          height={layout.sitemapScrollHeight}
          width={layout.sitemapScrollWidth}
          viewportOptions={{
            height: Math.max(1, layout.sitemapScrollHeight - 1),
          }}
          scrollX={true}
          stickyScroll={false}
          verticalScrollbarOptions={{
            width: 2,
            visible: true,
            trackOptions: dashboardScrollbarTrackOptions,
          }}
          horizontalScrollbarOptions={{
            visible: true,
            trackOptions: dashboardScrollbarTrackOptions,
          }}
        >
          <SitemapTree
            nodes={mockSitemapTree}
            selectedIndex={dashboardState.selectedSitemapItem}
            focused={dashboardState.activePanel === "sitemap"}
          />
        </scrollbox>
      </DashboardPanel>

      <DashboardPanel
        title="Findings"
        panelNumber={getPanelDisplayNumber(dashboardPanels, "findings")}
        height={layout.leftPanelBottomHeight}
        focused={dashboardState.activePanel === "findings"}
        paddingBottom={0}
        onMouseDown={() => setActivePanel("findings")}
      >
        <scrollbox
          ref={findingsScrollRef}
          height={layout.findingsScrollHeight}
          width={layout.findingsScrollWidth}
          viewportOptions={{
            height: Math.max(1, layout.findingsScrollHeight - 1),
          }}
          scrollX={true}
          stickyScroll={false}
          verticalScrollbarOptions={{
            width: 2,
            visible: true,
            trackOptions: dashboardScrollbarTrackOptions,
          }}
          horizontalScrollbarOptions={{
            visible: true,
            trackOptions: dashboardScrollbarTrackOptions,
          }}
        >
          <FindingList
            findings={findings}
            selectedIndex={dashboardState.selectedFindingItem}
            focused={dashboardState.activePanel === "findings"}
            onSelectFinding={selectFinding}
          />
        </scrollbox>
      </DashboardPanel>
    </box>
  );
};

export const CenterDashboardPanel = ({
  dashboardState,
  layout,
  setChatInput,
  submitChat,
  setActivePanel,
}: {
  dashboardState: DashboardState;
  layout: UseDashboardLayoutResult;
  setChatInput: (value: string) => void;
  submitChat: () => void;
  setActivePanel: (panel: DashboardPanelId) => void;
}) => {
  return (
    <box
      width={layout.centerPanelWidth}
      height={layout.contentHeight}
      flexDirection="column"
    >
      <DashboardPanel
        title="AI Assistant"
        panelNumber={getPanelDisplayNumber(dashboardPanels, "chat")}
        flexGrow={1}
        focused={dashboardState.activePanel === "chat"}
        onMouseDown={() => setActivePanel("chat")}
      >
        <ChatWindow
          messages={mockChatMessages}
          inputValue={dashboardState.chatInput}
          onInputChange={setChatInput}
          onSubmit={submitChat}
          focused={dashboardState.activePanel === "chat"}
        />
      </DashboardPanel>
    </box>
  );
};

export const RightDashboardPanel = ({
  dashboardState,
  layout,
  setActivePanel,
}: {
  dashboardState: DashboardState;
  layout: UseDashboardLayoutResult;
  setActivePanel: (panel: DashboardPanelId) => void;
}) => {
  return (
    <box
      width={layout.rightPanelWidth}
      height={layout.contentHeight}
      flexDirection="column"
    >
      <DashboardPanel
        title="Tools"
        panelNumber={getPanelDisplayNumber(dashboardPanels, "tools")}
        flexGrow={1}
        focused={dashboardState.activePanel === "tools"}
        onMouseDown={() => setActivePanel("tools")}
      >
        <box marginBottom={2}>
          <ToolList
            tools={tools}
            selectedIndex={dashboardState.selectedTool}
            focused={dashboardState.activePanel === "tools"}
          />
        </box>
        <box flexDirection="column">
          <box marginBottom={1}>
            <text fg={theme.accent.primary}>
              <strong>Quick Actions</strong>
            </text>
          </box>
          <box flexDirection="column" gap={0}>
            <text fg={theme.text.secondary}>r Re-scan</text>
            <text fg={theme.text.secondary}>e Export report</text>
            <text fg={theme.text.secondary}>s Settings</text>
          </box>
        </box>
      </DashboardPanel>
    </box>
  );
};
