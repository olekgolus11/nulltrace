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
import { DashboardState } from "../model/dashboard.state";
import { UseDashboardLayoutResult } from "../model/dashboard.types";
import { DashboardPanel } from "./DashboardPanel";
import { ToolList } from "./ToolList";

export const LeftDashboardPanel = ({
  dashboardState,
  layout,
}: {
  dashboardState: DashboardState;
  layout: UseDashboardLayoutResult;
}) => {
  return (
    <box
      width={layout.leftPanelWidth}
      height={layout.contentHeight}
      flexDirection="column"
    >
      <DashboardPanel
        title="Sitemap"
        height={layout.leftPanelTopHeight}
        focused={dashboardState.activePanel === "sitemap"}
      >
        <scrollbox
          height={layout.sitemapScrollHeight}
          width={layout.sitemapScrollWidth}
          focused={dashboardState.activePanel === "sitemap"}
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
        height={layout.leftPanelBottomHeight}
        focused={dashboardState.activePanel === "vulns"}
      >
        <scrollbox
          height={layout.vulnsScrollHeight}
          width={layout.vulnsScrollWidth}
          focused={dashboardState.activePanel === "vulns"}
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
}: {
  dashboardState: DashboardState;
  layout: UseDashboardLayoutResult;
  setChatInput: (value: string) => void;
  submitChat: () => void;
}) => {
  return (
    <box
      width={layout.centerPanelWidth}
      height={layout.contentHeight}
      flexDirection="column"
    >
      <DashboardPanel
        title="AI Assistant"
        flexGrow={1}
        focused={dashboardState.activePanel === "chat"}
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
}: {
  dashboardState: DashboardState;
  layout: UseDashboardLayoutResult;
}) => {
  return (
    <box
      width={layout.rightPanelWidth}
      height={layout.contentHeight}
      flexDirection="column"
    >
      <DashboardPanel
        title="Tools"
        flexGrow={1}
        focused={dashboardState.activePanel === "tools"}
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
