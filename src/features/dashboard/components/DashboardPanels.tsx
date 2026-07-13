import { ScrollBoxRenderable } from "@opentui/core";
import { theme } from "../../../app/theme/theme";
import { ActionDraftList } from "../../action-draft/components/ActionDraftList";
import { ActionDraftRecord } from "../../action-draft/model/action-draft.types";
import { SessionChatPanel } from "../../chat/components/SessionChatPanel";
import { ChatMessageData } from "../../chat/model/chat.types";
import { ActiveSessionConversation } from "../../chat/services/session-conversation.service";
import { SessionFindingRecord } from "../../finding/model/finding.types";
import { SitemapTree } from "../../sitemap/components/SitemapTree";
import { flattenTree } from "../../sitemap/model/sitemap.utils";
import {
  AuthenticatedSitemapCrawlStatusRecord,
  SitemapNode,
  TargetSitemapCrawlStatusRecord,
  TargetSitemapProvenanceFilter,
} from "../../sitemap/model/sitemap.types";
import { FindingList } from "../../finding/components/FindingList";
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
  sitemapNodes,
  sitemapEntryCount,
  visibleSitemapEntryCount,
  sitemapMaxDepth,
  sitemapProvenanceFilter,
  sitemapStatus,
  authenticatedSitemapStatus,
  findings,
  layout,
  sitemapScrollRef,
  findingsScrollRef,
  setActivePanel,
  selectFinding,
}: {
  dashboardState: DashboardState;
  sitemapNodes: SitemapNode[];
  sitemapEntryCount: number;
  visibleSitemapEntryCount: number;
  sitemapMaxDepth: number | null;
  sitemapProvenanceFilter: TargetSitemapProvenanceFilter;
  sitemapStatus: TargetSitemapCrawlStatusRecord | null;
  authenticatedSitemapStatus: AuthenticatedSitemapCrawlStatusRecord | null;
  findings: SessionFindingRecord[];
  layout: UseDashboardLayoutResult;
  sitemapScrollRef: React.RefObject<ScrollBoxRenderable | null>;
  findingsScrollRef: React.RefObject<ScrollBoxRenderable | null>;
  setActivePanel: (panel: DashboardPanelId) => void;
  selectFinding: (index: number) => void;
}) => {
  const selectedSitemapNode = flattenTree(sitemapNodes)[
    dashboardState.selectedSitemapItem
  ];

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
          contentOptions={{
            paddingRight: 1,
          }}
          scrollX={true}
          stickyScroll={false}
          verticalScrollbarOptions={{
            visible: true,
            trackOptions: dashboardScrollbarTrackOptions,
          }}
          horizontalScrollbarOptions={{
            visible: true,
            trackOptions: dashboardScrollbarTrackOptions,
          }}
        >
          <box flexDirection="column">
            {sitemapStatus?.status === "running" ? (
              <text fg={theme.accent.primary}>
                <strong>Scanning sitemap...</strong> {sitemapEntryCount} target entries discovered
              </text>
            ) : sitemapStatus?.status === "failed" ? (
              <>
                <text fg={theme.accent.warning}>
                  {sitemapEntryCount > 0
                    ? `Sitemap scan incomplete | ${sitemapEntryCount} target entries retained`
                    : "Sitemap scan failed | No target sitemap entries discovered."}
                </text>
                {sitemapStatus.errorMessage ? (
                  <text fg={theme.text.secondary}>Error: {sitemapStatus.errorMessage}</text>
                ) : null}
              </>
            ) : sitemapStatus?.status === "completed" ? (
              <text fg={theme.text.secondary}>
                {sitemapEntryCount > 0
                  ? `Sitemap scan complete | ${sitemapEntryCount} target entries`
                  : "Sitemap scan complete | No target sitemap entries discovered."}
              </text>
            ) : (
              <text fg={theme.text.dim}>Waiting to scan target sitemap...</text>
            )}
            {sitemapEntryCount > 0 ? (
              <text fg={theme.text.dim}>
                Depth: {sitemapMaxDepth === null ? "all" : `0-${sitemapMaxDepth}`} |{" "}
                Provenance: {sitemapProvenanceFilter} | {visibleSitemapEntryCount} visible
              </text>
            ) : null}
            {authenticatedSitemapStatus?.status === "running" ? (
              <text fg={theme.accent.primary}>Authenticated crawl running...</text>
            ) : authenticatedSitemapStatus?.status === "authentication_required" ? (
              <text fg={theme.accent.warning}>
                Authenticated crawl paused: authentication required
              </text>
            ) : null}
            {sitemapEntryCount > 0 ? (
              <text fg={theme.text.dim}>
                Left/Right depth | P/Shift+P provenance | Access is current-session only
              </text>
            ) : null}
          </box>
          {selectedSitemapNode?.entryId ? (
            <box
              flexDirection="column"
              border
              borderColor={theme.border.muted}
              paddingLeft={1}
              paddingRight={1}
            >
              <text fg={theme.text.secondary}>
                Detail: {selectedSitemapNode.method ?? "GET"} {selectedSitemapNode.path}
              </text>
              <text fg={theme.text.dim}>
                Discovery: {selectedSitemapNode.provenance ?? "public"}
              </text>
              <text fg={theme.text.dim}>
                {selectedSitemapNode.accessObservation
                  ? `Current session observed HTTP ${selectedSitemapNode.accessObservation.httpStatus}; not role-wide access.`
                  : "No authenticated access observation for current session."}
              </text>
            </box>
          ) : null}
          <SitemapTree
            nodes={sitemapNodes}
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
          contentOptions={{
            paddingRight: 1,
          }}
          scrollX={true}
          stickyScroll={false}
          verticalScrollbarOptions={{
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
  conversationError,
  conversations,
  isLoadingConversations,
  isCreatingConversation,
  isArchivingConversation,
  selectConversation,
  createConversation,
  archiveActiveConversation,
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
  conversationError: string | null;
  conversations: ActiveSessionConversation[];
  isLoadingConversations: boolean;
  isCreatingConversation: boolean;
  isArchivingConversation: boolean;
  selectConversation: (conversationId: string) => void;
  createConversation: () => void;
  archiveActiveConversation: () => void;
  chatMessages: ChatMessageData[];
  isLoadingMessages: boolean;
  isGenerating: boolean;
  chatError: string | null;
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
        <SessionChatPanel
          messages={chatMessages}
          inputValue={chatInput}
          availableWidth={Math.max(1, layout.centerPanelWidth - 4)}
          activeConversationId={activeConversationId}
          conversations={conversations}
          conversationError={conversationError}
          chatError={chatError}
          isLoadingConversations={isLoadingConversations}
          isCreatingConversation={isCreatingConversation}
          isArchivingConversation={isArchivingConversation}
          isLoadingMessages={isLoadingMessages}
          isGenerating={isGenerating}
          focused={dashboardState.activePanel === "chat"}
          onInputChange={setChatInput}
          onSubmit={submitChat}
          onSelectConversation={selectConversation}
          onCreateConversation={createConversation}
          onArchiveConversation={archiveActiveConversation}
        />
      </DashboardPanel>
    </box>
  );
};

export const RightDashboardPanel = ({
  dashboardState,
  layout,
  actionDrafts,
  setActivePanel,
  onSelectActionDraft,
}: {
  dashboardState: DashboardState;
  layout: UseDashboardLayoutResult;
  actionDrafts: ActionDraftRecord[];
  setActivePanel: (panel: DashboardPanelId) => void;
  onSelectActionDraft: (draft: ActionDraftRecord) => void;
}) => {
  const visibleActionDrafts = actionDrafts.filter(
    (draft) => draft.status !== "dismissed" && draft.status !== "superseded",
  );

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
        <box flexDirection="column" marginTop={2}>
          <box marginBottom={1}>
            <text fg={theme.accent.primary}>
              <strong>Action Drafts</strong>
            </text>
          </box>
          <scrollbox
            height={Math.max(4, Math.min(10, layout.contentHeight - 18))}
            width={Math.max(1, layout.rightPanelWidth - 4)}
            viewportOptions={{
              height: Math.max(3, Math.min(9, layout.contentHeight - 19)),
            }}
            contentOptions={{
              paddingRight: 1,
            }}
            stickyScroll={false}
            verticalScrollbarOptions={{
              visible: true,
              trackOptions: dashboardScrollbarTrackOptions,
            }}
          >
            <ActionDraftList
              drafts={visibleActionDrafts}
              emptyLabel="No action drafts yet."
              focused={dashboardState.activePanel === "tools"}
              selectedDraftId={visibleActionDrafts[0]?.id ?? null}
              onApplyDraft={onSelectActionDraft}
            />
          </scrollbox>
        </box>
      </DashboardPanel>
    </box>
  );
};
