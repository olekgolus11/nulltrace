import { ScrollBoxRenderable } from "@opentui/core";
import { theme } from "../../../app/theme/theme";
import { ChatWindow } from "../../chat/components/ChatWindow";
import { ChatMessageData } from "../../chat/model/chat.types";
import { SessionFindingRecord } from "../../finding/model/finding.types";
import { SitemapTree } from "../../sitemap/components/SitemapTree";
import { FindingList } from "../../finding/components/FindingList";
import { mockSitemapTree } from "../data/dashboard.mock";
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
  chatInput,
  setActivePanel,
  activeConversationId,
  activeConversationTitle,
  conversationError,
  chatMessages,
  isLoadingMessages,
  isGenerating,
  chatError,
}: {
  dashboardState: DashboardState;
  layout: UseDashboardLayoutResult;
  setChatInput: (value: string) => void;
  submitChat: (value: string) => void;
  chatInput: string;
  setActivePanel: (panel: DashboardPanelId) => void;
  activeConversationId: string | null;
  activeConversationTitle: string;
  conversationError: string | null;
  chatMessages: ChatMessageData[];
  isLoadingMessages: boolean;
  isGenerating: boolean;
  chatError: string | null;
}) => {
  const runtimeStatusMessage = conversationError
    ? `OpenCode runtime error: ${conversationError}`
    : activeConversationId
      ? `OpenCode conversation: ${activeConversationTitle || activeConversationId}`
      : "Preparing OpenCode conversation...";
  const chatStatusMessage = chatError
    ? `Chat error: ${chatError}`
    : isGenerating
      ? "Generating assistant response..."
      : isLoadingMessages
        ? "Loading conversation messages..."
        : null;

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
        <box marginBottom={1}>
          <text
            fg={conversationError ? theme.severity.high : theme.text.secondary}
          >
            {runtimeStatusMessage}
          </text>
        </box>
        {chatStatusMessage ? (
          <box marginBottom={1}>
            <text fg={chatError ? theme.severity.high : theme.text.secondary}>
              {chatStatusMessage}
            </text>
          </box>
        ) : null}
        <ChatWindow
          messages={chatMessages}
          inputValue={chatInput}
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
