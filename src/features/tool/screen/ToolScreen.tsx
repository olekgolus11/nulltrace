import { ScrollBoxRenderable } from "@opentui/core";
import { useTerminalDimensions } from "@opentui/react";
import { useEffect, useRef } from "react";
import { theme } from "../../../app/theme/theme";
import { Header } from "../../../shared/ui/Header";
import { StatusBar } from "../../../shared/ui/StatusBar";
import { getPanelDisplayNumber } from "../../../shared/model/panel-navigation";
import { SessionChatPanel } from "../../chat/components/SessionChatPanel";
import { useSessionChat } from "../../chat/hooks/use-session-chat";
import { DashboardPanel } from "../../dashboard/components/DashboardPanel";
import { useSessionFindings } from "../../finding/hooks/use-session-findings";
import { useSessionContextStore } from "../../session/store/session-context.store";
import { useToolLayout } from "../hooks/use-tool-layout";
import { ActiveToolWorkspace } from "../shared/components/ActiveToolWorkspace";
import { ToolHelpDialog } from "../shared/components/ToolHelpDialog";
import { ToolRunHistoryPanel } from "../shared/components/ToolRunHistoryPanel";
import { useToolKeyboardNavigation } from "../shared/hooks/use-tool-keyboard-navigation";
import { toolPanels, toolRegistry } from "../shared/registry/tool-registry";
import { useToolWorkspaceStore } from "../shared/store/tool-workspace.store";
import { ToolData, ToolName } from "../shared/types/tool-screen.types";

interface ToolScreenProps {
  toolName: ToolName;
  onBack: () => void;
}

const emptyToolData: ToolData = {
  form: {},
  selectedField: 0,
};

function getToolData(
  toolName: ToolName,
  targetUrl: string,
  toolData: unknown,
): ToolData {
  const toolModule = toolRegistry[toolName];
  if (!toolModule) {
    return emptyToolData;
  }

  return (
    (toolData as ToolData | null) ??
    toolModule.createInitialToolData(targetUrl)
  );
}

export function ToolScreen({ toolName, onBack }: ToolScreenProps) {
  const { width, height } = useTerminalDimensions();
  const historyScrollRef = useRef<ScrollBoxRenderable | null>(null);
  const sessionId = useSessionContextStore((state) => state.sessionId);
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
  const sessionChat = useSessionChat(sessionId, activeConversationId, {
    onPromptComplete: () => {
      void refreshConversationTitles();
    },
  });
  const layout = useToolLayout({ width, height });
  const activePanel = useToolWorkspaceStore((state) => state.activePanel);
  const isHelpOpen = useToolWorkspaceStore((state) => state.isHelpOpen);
  const setActivePanel = useToolWorkspaceStore((state) => state.setActivePanel);
  const historyRuns = useToolWorkspaceStore((state) => state.historyRuns);
  const findingsRefreshKey = historyRuns
    .map((run) => `${run.id}:${run.status}:${run.endedAt ?? ""}`)
    .join("|");
  const sessionFindings = useSessionFindings(sessionId, findingsRefreshKey);
  const selectedHistoryRunId = useToolWorkspaceStore(
    (state) => state.selectedHistoryRunId,
  );
  const isHistoricPreview = useToolWorkspaceStore(
    (state) => state.isHistoricPreview,
  );
  const initializeWorkspace = useToolWorkspaceStore(
    (state) => state.initializeWorkspace,
  );
  const stopCommand = useToolWorkspaceStore((state) => state.stopCommand);
  const toolData = useToolWorkspaceStore((state) =>
    getToolData(toolName, targetUrl, state.toolData),
  );
  const focusPanel = (panel: typeof activePanel) => {
    if (isHelpOpen) {
      return;
    }

    setActivePanel(panel);
  };

  useToolKeyboardNavigation({
    onBack,
    historyScrollRef,
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

  useEffect(() => {
    if (!sessionId || !targetUrl) {
      return;
    }

    initializeWorkspace(toolName, targetUrl, sessionId);

    return () => {
      stopCommand();
    };
  }, [initializeWorkspace, sessionId, stopCommand, targetUrl, toolName]);

  return (
    <box
      flexDirection="column"
      width={width}
      height={height}
      backgroundColor={theme.bg.primary}
    >
      <Header
        title={`${toolName} Workspace`}
        subtitle="guided controls + raw command"
        targetUrl={targetUrl}
        counts={sessionFindings.counts}
      />

      <box flexDirection="row" height={layout.contentHeight}>
        <box
          width={layout.leftPanelWidth}
          height={layout.contentHeight}
          flexDirection="column"
        >
          <DashboardPanel
            title="Operator Chat"
            panelNumber={getPanelDisplayNumber(toolPanels, "chat")}
            flexGrow={1}
            focused={activePanel === "chat"}
            onMouseDown={() => focusPanel("chat")}
          >
            <SessionChatPanel
              messages={sessionChat.messages}
              inputValue={sessionChat.inputValue}
              availableWidth={Math.max(1, layout.leftPanelWidth - 4)}
              activeConversationId={activeConversationId}
              conversations={conversations}
              conversationError={conversationError}
              chatError={sessionChat.error}
              isLoadingConversations={isLoadingConversations}
              isCreatingConversation={isCreatingConversation}
              isArchivingConversation={isArchivingConversation}
              isLoadingMessages={sessionChat.isLoading}
              isGenerating={sessionChat.isGenerating}
              onInputChange={sessionChat.setInputValue}
              onSubmit={sessionChat.submitInput}
              placeholder={`Ask about ${toolName} usage, flags, or scan strategy...`}
              focused={activePanel === "chat"}
              onSelectConversation={selectConversation}
              onCreateConversation={() => {
                void createConversation();
              }}
              onArchiveConversation={() => {
                void archiveActiveConversation();
              }}
            />
          </DashboardPanel>
        </box>

        <box
          width={layout.rightPanelWidth}
          height={layout.contentHeight}
          flexDirection="row"
        >
          <box
            width={layout.workspacePanelWidth}
            height={layout.contentHeight}
            flexDirection="column"
          >
            <ActiveToolWorkspace toolName={toolName} />
          </box>
          <box
            width={layout.historyPanelWidth}
            height={layout.contentHeight}
            flexDirection="column"
          >
            <ToolRunHistoryPanel
              runs={historyRuns}
              selectedRunId={selectedHistoryRunId}
              focused={activePanel === "history"}
              scrollRef={historyScrollRef}
              onMouseDown={() => focusPanel("history")}
            />
          </box>
        </box>
      </box>

      {isHelpOpen && Number.isFinite(toolData.selectedField) ? (
        <ToolHelpDialog toolName={toolName} fieldId={toolData.selectedField} />
      ) : null}

      <StatusBar
        activePanel={activePanel}
        panels={toolPanels}
        hints={
          isHistoricPreview
            ? [
                { key: "Tab/Shift+Tab", label: "switch" },
                { key: "Ctrl+1-5", label: "jump" },
                { key: "Enter", label: "preview" },
                { key: "Ctrl+C", label: "exit preview" },
                { key: "ESC", label: "back" },
                { key: "Ctrl+Q", label: "quit" },
              ]
            : [
                { key: "Tab/Shift+Tab", label: "switch" },
                { key: "Ctrl+1-5", label: "jump" },
                { key: "Ctrl+R", label: "run" },
                { key: "Ctrl+H", label: "help" },
                ...(activePanel === "chat"
                  ? [
                      { key: "Ctrl+←/→", label: "conversation" },
                      { key: "Ctrl+N", label: "new" },
                      { key: "Ctrl+D", label: "archive" },
                    ]
                  : []),
                { key: "Ctrl+C", label: "cancel" },
                { key: "ESC", label: "back" },
                { key: "Ctrl+Q", label: "quit" },
              ]
        }
      />
    </box>
  );
}
