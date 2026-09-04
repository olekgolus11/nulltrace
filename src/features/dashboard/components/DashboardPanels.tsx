import { ScrollBoxRenderable } from "@opentui/core";
import { theme } from "../../../app/theme/theme";
import { ActionDraftList } from "../../action-draft/components/ActionDraftList";
import { ActionDraftRecord } from "../../action-draft/model/action-draft.types";
import { SessionChatPanel } from "../../chat/components/SessionChatPanel";
import { ChatMessageData } from "../../chat/model/chat.types";
import { ActiveSessionConversation } from "../../chat/services/session-conversation.service";
import { SessionFindingRecord } from "../../finding/model/finding.types";
import { SitemapLedger, SitemapLedgerHeader } from "../../sitemap/components/SitemapLedger";
import {
  AuthenticatedSitemapCrawlStatusRecord,
  SitemapNode,
  TargetSitemapCrawlStatusRecord,
  TargetSitemapProvenanceFilter,
} from "../../sitemap/model/sitemap.types";
import { FindingList } from "../../finding/components/FindingList";
import { tools } from "../data/tool-catalog";
import { DashboardPanelId, DashboardState } from "../model/dashboard.types";
import { UseDashboardLayoutResult } from "../model/dashboard.types";
import { DashboardPanel } from "./DashboardPanel";
import { ToolList } from "./ToolList";
import { SitemapCrawlControlPresentation } from "../../sitemap/model/sitemap-crawl-lifecycle";
import { standardScrollbarTrackOptions } from "../../../shared/ui/scrollbar.config";

export const LeftDashboardPanel = ({
  dashboardState,
  sitemapNodes,
  sitemapEntryCount,
  visibleSitemapEntryCount,
  sitemapMaxDepth,
  sitemapProvenanceFilter,
  sitemapStatus,
  authenticatedSitemapStatus,
  authenticatedAccessDeniedCount,
  sitemapCrawlControls,
  findings,
  layout,
  sitemapScrollRef,
  findingsScrollRef,
  setActivePanel,
  selectSitemapEntry,
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
  authenticatedAccessDeniedCount: number;
  sitemapCrawlControls: SitemapCrawlControlPresentation;
  findings: SessionFindingRecord[];
  layout: UseDashboardLayoutResult;
  sitemapScrollRef: React.RefObject<ScrollBoxRenderable | null>;
  findingsScrollRef: React.RefObject<ScrollBoxRenderable | null>;
  setActivePanel: (panel: DashboardPanelId) => void;
  selectSitemapEntry: (index: number) => void;
  selectFinding: (index: number) => void;
}) => {
  const sitemapLedgerWidth = Math.max(1, layout.sitemapScrollWidth - 1);
  const hasFilterSummary = sitemapEntryCount > 0;
  const hasAuthenticatedStatus =
    authenticatedSitemapStatus?.status === "running" ||
    authenticatedSitemapStatus?.status === "paused" ||
    authenticatedSitemapStatus?.status === "authentication_required" ||
    (authenticatedSitemapStatus?.status === "completed" && authenticatedAccessDeniedCount > 0);
  const sitemapHeaderHeight = 3 + (hasFilterSummary ? 1 : 0) + (hasAuthenticatedStatus ? 1 : 0);
  const sitemapLedgerHeight = Math.max(1, layout.sitemapScrollHeight - sitemapHeaderHeight);
  const sitemapStatusSummary =
    sitemapStatus?.status === "running"
      ? `${sitemapEntryCount} routes \u00b7 public crawl running`
      : sitemapStatus?.status === "paused"
        ? `${sitemapEntryCount} routes \u00b7 public crawl paused`
        : sitemapStatus?.status === "failed"
          ? `${sitemapEntryCount} routes \u00b7 incomplete`
          : sitemapStatus?.status === "completed"
            ? `${sitemapEntryCount} routes \u00b7 complete`
            : `${sitemapEntryCount} routes \u00b7 waiting`;
  const sitemapStatusColor =
    sitemapStatus?.status === "failed"
      ? theme.accent.warning
      : sitemapStatus?.status === "running"
        ? theme.accent.primary
        : theme.text.secondary;
  const sitemapScopeLabel =
    sitemapProvenanceFilter === "authenticated"
      ? "auth"
      : sitemapProvenanceFilter === "public"
        ? "pub"
        : sitemapProvenanceFilter;

  return (
    <box width={layout.leftPanelWidth} height={layout.contentHeight} flexDirection="column">
      <DashboardPanel
        title="Route Ledger"
        height={layout.leftPanelTopHeight}
        focused={dashboardState.activePanel === "sitemap"}
        paddingBottom={0}
        onMouseDown={() => setActivePanel("sitemap")}
      >
        <box flexDirection="column" width={sitemapLedgerWidth}>
          <text fg={sitemapStatusColor}>{sitemapStatusSummary}</text>
          {hasFilterSummary ? (
            <text fg={theme.text.dim}>
              {`depth ${sitemapMaxDepth === null ? "all" : `0-${sitemapMaxDepth}`} \u00b7 scope ${sitemapScopeLabel} \u00b7 ${visibleSitemapEntryCount} shown`}
            </text>
          ) : null}
          {authenticatedSitemapStatus?.status === "running" ? (
            <text fg={theme.accent.primary}>authenticated crawl running</text>
          ) : authenticatedSitemapStatus?.status === "paused" ? (
            <text fg={theme.text.secondary}>authenticated crawl paused</text>
          ) : authenticatedSitemapStatus?.status === "authentication_required" ? (
            <text fg={theme.accent.warning}>{"auth required \u00b7 crawl paused"}</text>
          ) : authenticatedSitemapStatus?.status === "completed" &&
            authenticatedAccessDeniedCount > 0 ? (
            <text fg={theme.accent.warning}>
              {`Completed \u00b7 ${authenticatedAccessDeniedCount} access-denied ${authenticatedAccessDeniedCount === 1 ? "response" : "responses"}`}
            </text>
          ) : null}
          <text
            fg={
              sitemapCrawlControls.actions?.requiresAuthCheck
                ? theme.accent.warning
                : theme.text.dim
            }
          >
            {sitemapCrawlControls.hint}
          </text>
          <SitemapLedgerHeader availableWidth={sitemapLedgerWidth} />
        </box>
        <scrollbox
          ref={sitemapScrollRef}
          height={sitemapLedgerHeight}
          width={layout.sitemapScrollWidth}
          viewportOptions={{
            height: sitemapLedgerHeight,
          }}
          contentOptions={{
            paddingRight: 0,
          }}
          scrollX={false}
          stickyScroll={false}
          verticalScrollbarOptions={{
            visible: true,
            trackOptions: standardScrollbarTrackOptions,
          }}
          horizontalScrollbarOptions={{
            visible: false,
          }}
        >
          <SitemapLedger
            nodes={sitemapNodes}
            selectedIndex={dashboardState.selectedSitemapItem}
            isFocused={dashboardState.activePanel === "sitemap"}
            availableWidth={sitemapLedgerWidth}
            onSelectEntry={selectSitemapEntry}
            emptyMessage={
              sitemapEntryCount > 0 ? "No routes match current filters." : "No routes discovered."
            }
          />
        </scrollbox>
      </DashboardPanel>

      <DashboardPanel
        title="Findings"
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
            trackOptions: standardScrollbarTrackOptions,
          }}
          horizontalScrollbarOptions={{
            visible: true,
            trackOptions: standardScrollbarTrackOptions,
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
    <box width={layout.centerPanelWidth} height={layout.contentHeight} flexDirection="column">
      <DashboardPanel
        title="AI Assistant"
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
    <box width={layout.rightPanelWidth} height={layout.contentHeight} flexDirection="column">
      <DashboardPanel
        title="Tools"
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
              <strong>Action Drafts</strong>
            </text>
          </box>
          <scrollbox
            height={Math.max(4, Math.min(16, layout.contentHeight - 12))}
            width={Math.max(1, layout.rightPanelWidth - 4)}
            viewportOptions={{
              height: Math.max(3, Math.min(15, layout.contentHeight - 13)),
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
