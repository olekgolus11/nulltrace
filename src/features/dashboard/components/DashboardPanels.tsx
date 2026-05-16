import { ScrollBoxRenderable } from "@opentui/core";
import { theme } from "../../../app/theme/theme";
import { ChatWindow } from "../../chat/components/ChatWindow";
import { SitemapTree } from "../../sitemap/components/SitemapTree";
import { VulnerabilityList } from "../../vulnerability/components/VulnerabilityList";
import {
  mockSitemapTree,
  mockVulnerabilities,
  mockChatMessages,
} from "../data/dashboard.mock";
import { tools } from "../data/tool-catalog";
import {
  dashboardPanels,
} from "../model/dashboard.state";
import { DashboardPanelId, DashboardState } from "../model/dashboard.types";
import { UseDashboardLayoutResult } from "../model/dashboard.types";
import { DashboardPanel } from "./DashboardPanel";
import { ToolList } from "./ToolList";
import { getPanelDisplayNumber } from "../../../shared/model/panel-navigation";

export const LeftDashboardPanel = ({
  dashboardState,
  layout,
  sitemapScrollRef,
  vulnsScrollRef,
  setActivePanel,
}: {
  dashboardState: DashboardState;
  layout: UseDashboardLayoutResult;
  sitemapScrollRef: React.RefObject<ScrollBoxRenderable | null>;
  vulnsScrollRef: React.RefObject<ScrollBoxRenderable | null>;
  setActivePanel: (panel: DashboardPanelId) => void;
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
          scrollX={true}
          stickyScroll={false}
          verticalScrollbarOptions={{
            width: 2,
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
        title="Vulnerabilities"
        panelNumber={getPanelDisplayNumber(dashboardPanels, "vulns")}
        height={layout.leftPanelBottomHeight}
        focused={dashboardState.activePanel === "vulns"}
        paddingBottom={0}
        onMouseDown={() => setActivePanel("vulns")}
      >
        <scrollbox
          ref={vulnsScrollRef}
          height={layout.vulnsScrollHeight}
          width={layout.vulnsScrollWidth}
          scrollX={true}
          verticalScrollbarOptions={{
            width: 2,
          }}
        >
          <VulnerabilityList
            vulnerabilities={mockVulnerabilities}
            selectedIndex={dashboardState.selectedVulnItem}
            focused={dashboardState.activePanel === "vulns"}
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
