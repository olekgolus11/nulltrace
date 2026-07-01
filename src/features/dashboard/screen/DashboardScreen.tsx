import { useTerminalDimensions } from "@opentui/react";
import { theme } from "../../../app/theme/theme";
import {
  CenterDashboardPanel,
  LeftDashboardPanel,
  RightDashboardPanel,
} from "../components/DashboardPanels";
import { useDashboardLayout } from "../hooks/use-dashboard-layout";
import { useDashboardShortcuts } from "../hooks/use-dashboard-shortcuts";
import { dashboardPanels } from "../model/dashboard.state";
import { Header } from "../../../shared/ui/Header";
import { StatusBar } from "../../../shared/ui/StatusBar";
import { useSessionChat } from "../../chat/hooks/use-session-chat";
import { FindingDetailModal } from "../../finding/components/FindingDetailModal";
import { useSessionFindings } from "../../finding/hooks/use-session-findings";
import { useSessionContextStore } from "../../session/store/session-context.store";
import { ToolName } from "../../tool/shared/types/tool-screen.types";

interface DashboardScreenProps {
  onSelectTool: (toolName: ToolName) => void;
  onBack: () => void;
}

export function DashboardScreen({
  onSelectTool,
  onBack,
}: DashboardScreenProps) {
  const { width, height } = useTerminalDimensions();
  const sessionId = useSessionContextStore((state) => state.sessionId);
  const targetUrl = useSessionContextStore((state) => state.targetUrl);
  const activeConversationId = useSessionContextStore(
    (state) => state.activeConversationId,
  );
  const activeConversationTitle = useSessionContextStore(
    (state) => state.activeConversationTitle,
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
  const sessionChat = useSessionChat(sessionId, activeConversationId, {
    onPromptComplete: () => {
      void refreshConversationTitles();
    },
  });
  const sessionFindings = useSessionFindings(sessionId);
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
  } = useDashboardShortcuts({
    onBack,
    onSelectTool,
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
      <Header targetUrl={targetUrl} counts={sessionFindings.counts} />
      <box flexDirection="row" height={layout.contentHeight}>
        <LeftDashboardPanel
          layout={layout}
          dashboardState={dashboardState}
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
          activeConversationTitle={activeConversationTitle}
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
          setActivePanel={setActivePanel}
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
                ...(dashboardState.activePanel === "chat"
                  ? [
                      { key: "Ctrl+←/→", label: "conversation" },
                      { key: "Ctrl+N", label: "new" },
                      { key: "Ctrl+D", label: "archive" },
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
    </box>
  );
}
