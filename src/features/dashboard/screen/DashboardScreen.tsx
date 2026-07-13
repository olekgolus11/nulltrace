import { useTerminalDimensions } from "@opentui/react";
import { theme } from "../../../app/theme/theme";
import {
  CenterDashboardPanel,
  LeftDashboardPanel,
  RightDashboardPanel,
} from "../components/DashboardPanels";
import { ActionDraftRecord } from "../../action-draft/model/action-draft.types";
import { useSessionActionDrafts } from "../../action-draft/hooks/use-session-action-drafts";
import { useDashboardLayout } from "../hooks/use-dashboard-layout";
import { useDashboardShortcuts } from "../hooks/use-dashboard-shortcuts";
import { dashboardPanels } from "../model/dashboard.state";
import { Header } from "../../../shared/ui/Header";
import { StatusBar } from "../../../shared/ui/StatusBar";
import { useSessionChat } from "../../chat/hooks/use-session-chat";
import { FindingDetailModal } from "../../finding/components/FindingDetailModal";
import { useSessionFindings } from "../../finding/hooks/use-session-findings";
import { useSessionContextStore } from "../../session/store/session-context.store";
import { useTargetSitemap } from "../../sitemap/hooks/use-target-sitemap";
import { ToolName } from "../../tool/shared/types/tool-screen.types";
import { AuthenticationContextModal } from "../../authentication/components/AuthenticationContextModal";
import { useSessionAuthenticatedRequestContext } from "../../authentication/hooks/use-session-authenticated-request-context";
import { createAuthCheckUrlSuggestions } from "../../authentication/services/auth-check.service";

interface DashboardScreenProps {
  onSelectTool: (toolName: ToolName) => void;
  onSelectActionDraft: (draft: ActionDraftRecord) => void;
  onBack: () => void;
}

export function DashboardScreen({
  onSelectTool,
  onSelectActionDraft,
  onBack,
}: DashboardScreenProps) {
  const { width, height } = useTerminalDimensions();
  const sessionId = useSessionContextStore((state) => state.sessionId);
  const targetId = useSessionContextStore((state) => state.targetId);
  const targetUrl = useSessionContextStore((state) => state.targetUrl);
  const activeConversationId = useSessionContextStore(
    (state) => state.activeConversationId,
  );
  const conversationError = useSessionContextStore(
    (state) => state.conversationError,
  );
  const conversations = useSessionContextStore((state) => state.conversations);
  const isLoadingConversations = useSessionContextStore(
    (state) => state.isLoadingConversations,
  );
  const isCreatingConversation = useSessionContextStore(
    (state) => state.isCreatingConversation,
  );
  const isArchivingConversation = useSessionContextStore(
    (state) => state.isArchivingConversation,
  );
  const selectConversation = useSessionContextStore(
    (state) => state.selectConversation,
  );
  const createConversation = useSessionContextStore(
    (state) => state.createConversation,
  );
  const archiveActiveConversation = useSessionContextStore(
    (state) => state.archiveActiveConversation,
  );
  const refreshConversationTitles = useSessionContextStore(
    (state) => state.refreshConversationTitles,
  );
  const { drafts, refreshDrafts } = useSessionActionDrafts(sessionId);
  const authenticationContext = useSessionAuthenticatedRequestContext(
    sessionId,
    targetId,
    targetUrl,
  );
  const sessionChat = useSessionChat(sessionId, activeConversationId, {
    onPromptComplete: () => {
      void refreshConversationTitles();
      refreshDrafts();
    },
  });
  const sessionFindings = useSessionFindings(sessionId);
  const targetSitemap = useTargetSitemap(targetId, sessionId);
  const verificationUrlSuggestions = createAuthCheckUrlSuggestions(
    targetUrl,
    targetSitemap.entries
      .filter((entry) => !entry.method || entry.method === "GET")
      .map((entry) => entry.normalizedUrl),
  );
  const layout = useDashboardLayout({
    width,
    height,
  });
  const {
    dashboardState,
    setActivePanel,
    selectFinding,
    sitemapScrollRef,
    findingsScrollRef,
    findingDetailScrollRef,
    closeAuthenticationContext,
  } = useDashboardShortcuts({
    onBack,
    onSelectTool,
    sitemapCount: targetSitemap.flatNodes.length,
    onCycleSitemapDepth: targetSitemap.cycleMaxDepth,
    onCycleSitemapProvenance: targetSitemap.cycleProvenance,
    findings: sessionFindings.findings,
    onSetFindingReviewStatus: sessionFindings.setReviewStatus,
    conversations,
    activeConversationId,
    isConversationNavigationDisabled:
      sessionChat.isGenerating ||
      isLoadingConversations ||
      isCreatingConversation ||
      isArchivingConversation,
    onSelectConversation: selectConversation,
    onCreateConversation: () => {
      void createConversation();
    },
    onArchiveActiveConversation: () => {
      void archiveActiveConversation();
    },
  });
  const selectedFindingDetail = dashboardState.selectedFindingDetailId
    ? sessionFindings.findings.find(
        (finding) => finding.id === dashboardState.selectedFindingDetailId,
      )
    : null;
  const modalWidth = Math.max(1, Math.min(96, width - 8));
  const modalHeight = Math.max(1, Math.min(30, height - 6));

  return (
    <box
      flexDirection="column"
      width={width}
      height={height}
      backgroundColor={theme.bg.primary}
    >
      <Header
        targetUrl={targetUrl}
        counts={sessionFindings.counts}
        authenticationContext={authenticationContext.metadata}
      />
      <box flexDirection="row" height={layout.contentHeight}>
        <LeftDashboardPanel
          layout={layout}
          dashboardState={dashboardState}
          sitemapNodes={targetSitemap.nodes}
          sitemapEntryCount={targetSitemap.entries.length}
          visibleSitemapEntryCount={targetSitemap.visibleEntries.length}
          sitemapMaxDepth={targetSitemap.maxDepth}
          sitemapProvenanceFilter={targetSitemap.provenanceFilter}
          sitemapStatus={targetSitemap.status}
          authenticatedSitemapStatus={targetSitemap.authenticatedStatus}
          findings={sessionFindings.findings}
          sitemapScrollRef={sitemapScrollRef}
          findingsScrollRef={findingsScrollRef}
          setActivePanel={setActivePanel}
          selectFinding={selectFinding}
        />
        <CenterDashboardPanel
          layout={layout}
          dashboardState={dashboardState}
          submitChat={sessionChat.submitInput}
          setChatInput={sessionChat.setInputValue}
          chatInput={sessionChat.inputValue}
          setActivePanel={setActivePanel}
          activeConversationId={activeConversationId}
          conversationError={conversationError}
          conversations={conversations}
          isLoadingConversations={isLoadingConversations}
          isCreatingConversation={isCreatingConversation}
          isArchivingConversation={isArchivingConversation}
          selectConversation={selectConversation}
          createConversation={() => {
            void createConversation();
          }}
          archiveActiveConversation={() => {
            void archiveActiveConversation();
          }}
          chatMessages={sessionChat.messages}
          isLoadingMessages={sessionChat.isLoading}
          isGenerating={sessionChat.isGenerating}
          chatError={sessionChat.error}
        />
        <RightDashboardPanel
          layout={layout}
          dashboardState={dashboardState}
          actionDrafts={drafts}
          setActivePanel={setActivePanel}
          onSelectActionDraft={onSelectActionDraft}
        />
      </box>
      <StatusBar
        activePanel={dashboardState.activePanel}
        panels={dashboardPanels}
        hints={[
          ...(selectedFindingDetail
            ? [
                { key: "Up/Down", label: "scroll" },
                { key: "ESC", label: "close" },
              ]
            : [
                { key: "Tab/Shift+Tab", label: "switch" },
                { key: "Ctrl+1-4", label: "jump" },
                { key: "Ctrl+A", label: "auth" },
                ...(dashboardState.activePanel === "chat"
                  ? [
                      { key: "Ctrl+←/→", label: "conversation" },
                      { key: "Ctrl+N", label: "new" },
                      { key: "Ctrl+D", label: "archive" },
                    ]
                  : dashboardState.activePanel === "sitemap"
                    ? [
                        { key: "Up/Down", label: "navigate" },
                        { key: "Left/Right", label: "depth" },
                        { key: "P/Shift+P", label: "provenance" },
                      ]
                    : [{ key: "Enter", label: "select" }]),
                { key: "ESC", label: "back" },
                { key: "Ctrl+Q", label: "quit" },
              ]),
        ]}
      />
      {selectedFindingDetail ? (
        <FindingDetailModal
          finding={selectedFindingDetail}
          width={modalWidth}
          height={modalHeight}
          scrollRef={findingDetailScrollRef}
        />
      ) : null}
      {dashboardState.isAuthenticationContextOpen ? (
        <AuthenticationContextModal
          targetUrl={targetUrl}
          width={modalWidth}
          height={modalHeight}
          metadata={authenticationContext.metadata}
          verificationUrlSuggestions={verificationUrlSuggestions}
          isSaving={authenticationContext.isSaving}
          isChecking={authenticationContext.isChecking}
          error={authenticationContext.error}
          onSave={authenticationContext.save}
          onClear={authenticationContext.clear}
          onRunAuthCheck={authenticationContext.runAuthCheck}
          onAcknowledgeInconclusive={
            authenticationContext.acknowledgeInconclusive
          }
          onClose={closeAuthenticationContext}
        />
      ) : null}
    </box>
  );
}
