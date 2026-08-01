import { ScrollBoxRenderable } from "@opentui/core";
import { useTerminalDimensions } from "@opentui/react";
import { useEffect, useRef, useState } from "react";
import { theme } from "../../../app/theme/theme";
import { Header } from "../../../shared/ui/Header";
import { StatusBar } from "../../../shared/ui/StatusBar";
import { getPanelDisplayNumber } from "../../../shared/model/panel-navigation";
import { ActionDraftList } from "../../action-draft/components/ActionDraftList";
import { ActionDraftRecord } from "../../action-draft/model/action-draft.types";
import { useSessionActionDrafts } from "../../action-draft/hooks/use-session-action-drafts";
import { mapActionDraftToWorkspaceState } from "../../action-draft/services/action-draft-workspace.mapper";
import { actionDraftRepository } from "../../action-draft/services/action-draft.repository.instance";
import { SessionChatPanel } from "../../chat/components/SessionChatPanel";
import { useSessionChat } from "../../chat/hooks/use-session-chat";
import { DashboardPanel } from "../../dashboard/components/DashboardPanel";
import { useSessionFindings } from "../../finding/hooks/use-session-findings";
import { useSessionContextStore } from "../../session/store/session-context.store";
import { useSessionAuthenticatedRequestContext } from "../../authentication/hooks/use-session-authenticated-request-context";
import { isAcceptedAuthenticatedContextForTarget } from "../../authentication/services/authenticated-request-context-scope.helpers";
import { pageInspectionPermissionService } from "../../page-inspection/services/page-inspection-permission.service";
import { nucleiCommandService } from "../nuclei/services/nuclei-command.service";
import { NucleiToolData } from "../nuclei/types/nuclei.types";
import { setFfufAuthenticationAvailability } from "../ffuf/services/ffuf-authentication.helpers";
import { FfufToolData } from "../ffuf/types/ffuf.types";
import { niktoCommandService } from "../nikto/services/nikto-command.service";
import { NiktoToolData } from "../nikto/types/nikto.types";
import { useToolLayout } from "../hooks/use-tool-layout";
import { ActiveToolWorkspace } from "../shared/components/ActiveToolWorkspace";
import { ToolHelpDialog } from "../shared/components/ToolHelpDialog";
import { ToolRunHistoryPanel } from "../shared/components/ToolRunHistoryPanel";
import { ToolRunConfirmationDialog } from "../shared/components/ToolRunConfirmationDialog";
import { useToolKeyboardNavigation } from "../shared/hooks/use-tool-keyboard-navigation";
import { toolPanels, toolRegistry } from "../shared/registry/tool-registry";
import { toolWorkspaceContextService } from "../shared/services/tool-workspace-context.service";
import { getOwnedToolWorkspaceData } from "../shared/store/tool-workspace-data.helpers";
import { useToolWorkspaceStore } from "../shared/store/tool-workspace.store";
import { ToolData, ToolName } from "../shared/types/tool-screen.types";

interface ToolScreenProps {
  toolName: ToolName;
  onBack: () => void;
  pendingActionDraftId?: string | null;
}

const emptyToolData: ToolData = {
  form: {},
  selectedField: 0,
};

function getToolData(
  toolName: ToolName,
  activeToolName: string | null,
  targetUrl: string,
  toolData: unknown,
): ToolData {
  const toolModule = toolRegistry[toolName];
  if (!toolModule) {
    return emptyToolData;
  }

  return getOwnedToolWorkspaceData(
    activeToolName,
    toolName,
    toolData,
    () => toolModule.createInitialToolData(targetUrl),
  );
}

export function ToolScreen({ toolName, onBack, pendingActionDraftId = null }: ToolScreenProps) {
  const { width, height } = useTerminalDimensions();
  const actionDraftScrollRef = useRef<ScrollBoxRenderable | null>(null);
  const historyScrollRef = useRef<ScrollBoxRenderable | null>(null);
  const appliedPendingDraftIdRef = useRef<string | null>(null);
  const [selectedActionDraftIndex, setSelectedActionDraftIndex] = useState(0);
  const sessionId = useSessionContextStore((state) => state.sessionId);
  const targetId = useSessionContextStore((state) => state.targetId);
  const targetUrl = useSessionContextStore((state) => state.targetUrl);
  const authenticationContext = useSessionAuthenticatedRequestContext(
    sessionId,
    targetId,
    targetUrl,
  );
  const pageInspectionStatus = sessionId
    ? pageInspectionPermissionService.getStatus(sessionId)
    : null;
  const activeConversationId = useSessionContextStore((state) => state.activeConversationId);
  const conversationError = useSessionContextStore((state) => state.conversationError);
  const conversations = useSessionContextStore((state) => state.conversations);
  const isLoadingConversations = useSessionContextStore((state) => state.isLoadingConversations);
  const isCreatingConversation = useSessionContextStore((state) => state.isCreatingConversation);
  const isArchivingConversation = useSessionContextStore((state) => state.isArchivingConversation);
  const selectConversation = useSessionContextStore((state) => state.selectConversation);
  const createConversation = useSessionContextStore((state) => state.createConversation);
  const archiveActiveConversation = useSessionContextStore(
    (state) => state.archiveActiveConversation,
  );
  const refreshConversationTitles = useSessionContextStore(
    (state) => state.refreshConversationTitles,
  );
  const { drafts, refreshDrafts } = useSessionActionDrafts(sessionId);
  const sessionChat = useSessionChat(sessionId, activeConversationId, {
    onPromptComplete: () => {
      void refreshConversationTitles();
      refreshDrafts();
    },
  });
  const layout = useToolLayout({ width, height });
  const activePanel = useToolWorkspaceStore((state) => state.activePanel);
  const isHelpOpen = useToolWorkspaceStore((state) => state.isHelpOpen);
  const pendingRunConfirmation = useToolWorkspaceStore(
    (state) => state.pendingRunConfirmation,
  );
  const setActivePanel = useToolWorkspaceStore((state) => state.setActivePanel);
  const commandInput = useToolWorkspaceStore((state) => state.commandInput);
  const generatedCommand = useToolWorkspaceStore((state) => state.generatedCommand);
  const commandSource = useToolWorkspaceStore((state) => state.commandSource);
  const executionStatus = useToolWorkspaceStore((state) => state.executionStatus);
  const currentToolRunId = useToolWorkspaceStore((state) => state.currentToolRunId);
  const historyRuns = useToolWorkspaceStore((state) => state.historyRuns);
  const findingsRefreshKey = historyRuns
    .map((run) => `${run.id}:${run.status}:${run.endedAt ?? ""}`)
    .join("|");
  const sessionFindings = useSessionFindings(sessionId, findingsRefreshKey);
  const selectedHistoryRunId = useToolWorkspaceStore((state) => state.selectedHistoryRunId);
  const isHistoricPreview = useToolWorkspaceStore((state) => state.isHistoricPreview);
  const initializeWorkspace = useToolWorkspaceStore((state) => state.initializeWorkspace);
  const stopCommand = useToolWorkspaceStore((state) => state.stopCommand);
  const applyActionDraftState = useToolWorkspaceStore((state) => state.applyActionDraftState);
  const reportActionDraftApplyError = useToolWorkspaceStore(
    (state) => state.reportActionDraftApplyError,
  );
  const activeToolName = useToolWorkspaceStore((state) => state.toolName);
  const activeToolData = useToolWorkspaceStore((state) => state.toolData);
  const toolData = getToolData(toolName, activeToolName, targetUrl, activeToolData);
  const toolActionDrafts = drafts.filter((draft) => draft.targetTool === toolName);
  const visibleToolActionDrafts = toolActionDrafts.filter(
    (draft) => draft.status !== "dismissed" && draft.status !== "superseded",
  );
  const selectedActionDraft =
    visibleToolActionDrafts[
      Math.min(selectedActionDraftIndex, Math.max(0, visibleToolActionDrafts.length - 1))
    ] ?? null;
  const focusPanel = (panel: typeof activePanel) => {
    if (isHelpOpen) {
      return;
    }

    setActivePanel(panel);
  };
  const applyActionDraft = (draft: ActionDraftRecord) => {
    const state = useToolWorkspaceStore.getState();
    const toolModule = toolRegistry[toolName];

    if (!toolModule || !state.toolData) {
      reportActionDraftApplyError("The scanner workspace is not ready for this draft yet.");
      return;
    }

    const result = mapActionDraftToWorkspaceState({
      draft,
      currentToolName: toolName,
      currentToolData: state.toolData,
      buildGeneratedCommand: toolModule.buildGeneratedCommand,
      authenticatedContext: authenticationContext.metadata,
    });

    if (!result.ok) {
      reportActionDraftApplyError(result.reason);
      return;
    }

    const didApply = applyActionDraftState(result.application);
    if (!didApply) {
      return;
    }

    actionDraftRepository.setStatus({
      actionDraftId: draft.id,
      status: "applied",
    });
    refreshDrafts();
  };
  const archiveActionDraft = (draft: ActionDraftRecord) => {
    actionDraftRepository.setStatus({
      actionDraftId: draft.id,
      status: "dismissed",
    });
    refreshDrafts();
  };
  const moveActionDraftSelection = (direction: -1 | 1) => {
    setSelectedActionDraftIndex((currentIndex) =>
      Math.max(0, Math.min(visibleToolActionDrafts.length - 1, currentIndex + direction)),
    );
  };
  const applySelectedActionDraft = () => {
    if (selectedActionDraft) {
      applyActionDraft(selectedActionDraft);
    }
  };
  const selectAndApplyActionDraft = (draft: ActionDraftRecord) => {
    const draftIndex = visibleToolActionDrafts.findIndex(
      (visibleDraft) => visibleDraft.id === draft.id,
    );

    if (draftIndex >= 0) {
      setSelectedActionDraftIndex(draftIndex);
    }
    focusPanel("drafts");
    applyActionDraft(draft);
  };
  const archiveSelectedActionDraft = () => {
    if (selectedActionDraft) {
      archiveActionDraft(selectedActionDraft);
    }
  };

  useToolKeyboardNavigation({
    onBack,
    actionDraftScrollRef,
    historyScrollRef,
    onMoveActionDraftSelection: moveActionDraftSelection,
    onApplySelectedActionDraft: applySelectedActionDraft,
    onArchiveSelectedActionDraft: archiveSelectedActionDraft,
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

  useEffect(() => {
    if (toolName !== "nuclei" && toolName !== "ffuf" && toolName !== "nikto") {
      return;
    }
    const metadata = authenticationContext.metadata;
    const acceptedOrigin = isAcceptedAuthenticatedContextForTarget(metadata, targetUrl)
      ? metadata?.origin ?? null
      : null;
    const state = useToolWorkspaceStore.getState();
    if (state.toolName !== toolName || !state.toolData) {
      return;
    }
    const current = state.toolData as NucleiToolData | FfufToolData | NiktoToolData;
    if (
      current.authentication.origin === acceptedOrigin &&
      current.authentication.isAvailable === Boolean(acceptedOrigin)
    ) {
      return;
    }
    state.updateToolData((toolData) => {
      if (toolName === "nuclei") {
        return nucleiCommandService.setAuthenticationAvailability(
          toolData as NucleiToolData,
          acceptedOrigin,
        );
      }
      if (toolName === "nikto") {
        return niktoCommandService.setAuthenticationAvailability(
          toolData as NiktoToolData,
          acceptedOrigin,
        );
      }
      return setFfufAuthenticationAvailability(toolData as FfufToolData, acceptedOrigin);
    });
  }, [authenticationContext.metadata, targetUrl, toolName]);

  useEffect(() => {
    setSelectedActionDraftIndex((currentIndex) =>
      Math.max(0, Math.min(currentIndex, Math.max(0, visibleToolActionDrafts.length - 1))),
    );
  }, [visibleToolActionDrafts.length]);

  useEffect(() => {
    if (!pendingActionDraftId || appliedPendingDraftIdRef.current === pendingActionDraftId) {
      return;
    }

    const state = useToolWorkspaceStore.getState();
    if (state.toolName !== toolName || !state.toolData) {
      return;
    }

    const draft = drafts.find((candidate) => candidate.id === pendingActionDraftId);
    if (!draft) {
      return;
    }

    appliedPendingDraftIdRef.current = pendingActionDraftId;
    applyActionDraft(draft);
  }, [drafts, pendingActionDraftId]);

  useEffect(() => {
    if (!sessionId) {
      return;
    }

    toolWorkspaceContextService.saveActiveWorkspace({
      sessionId,
      toolName,
      activePanel,
      commandInput,
      generatedCommand,
      commandSource,
      executionStatus,
      currentToolRunId,
      selectedHistoryRunId,
      isHistoricPreview,
      toolData,
    });
  }, [
    activePanel,
    commandInput,
    commandSource,
    currentToolRunId,
    executionStatus,
    generatedCommand,
    isHistoricPreview,
    selectedHistoryRunId,
    sessionId,
    toolData,
    toolName,
  ]);

  useEffect(() => {
    if (!sessionId) {
      return;
    }

    return () => {
      toolWorkspaceContextService.clearActiveWorkspace(sessionId);
    };
  }, [sessionId]);

  return (
    <box flexDirection="column" width={width} height={height} backgroundColor={theme.bg.primary}>
      <Header
        title={`${toolName} Workspace`}
        subtitle="guided controls + raw command"
        targetUrl={targetUrl}
        counts={sessionFindings.counts}
        pageInspectionStatus={pageInspectionStatus}
        authenticationContext={authenticationContext.metadata}
      />

      <box flexDirection="row" height={layout.contentHeight}>
        <box width={layout.leftPanelWidth} height={layout.contentHeight} flexDirection="column">
          <DashboardPanel
            title="Action Drafts"
            panelNumber={getPanelDisplayNumber(toolPanels, "drafts")}
            height={Math.min(11, Math.max(8, layout.contentHeight - 12))}
            focused={activePanel === "drafts"}
            paddingBottom={0}
            onMouseDown={() => focusPanel("drafts")}
          >
            <scrollbox
              ref={actionDraftScrollRef}
              height={Math.max(1, Math.min(8, layout.contentHeight - 15))}
              width={Math.max(1, layout.leftPanelWidth - 4)}
              viewportOptions={{
                height: Math.max(1, Math.min(7, layout.contentHeight - 16)),
              }}
              contentOptions={{
                paddingRight: 1,
              }}
              stickyScroll={false}
              verticalScrollbarOptions={{
                visible: true,
                trackOptions: {
                  backgroundColor: theme.border.muted,
                  foregroundColor: theme.text.secondary,
                },
              }}
            >
              <ActionDraftList
                drafts={visibleToolActionDrafts}
                emptyLabel={`No ${toolName} action drafts yet.`}
                focused={activePanel === "drafts"}
                selectedDraftId={selectedActionDraft?.id ?? null}
                onApplyDraft={selectAndApplyActionDraft}
              />
            </scrollbox>
          </DashboardPanel>
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

        <box width={layout.rightPanelWidth} height={layout.contentHeight} flexDirection="row">
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
      {pendingRunConfirmation ? (
        <ToolRunConfirmationDialog
          confirmation={pendingRunConfirmation}
          onConfirm={() => {
            void useToolWorkspaceStore.getState().confirmPendingRun();
          }}
          onCancel={() => useToolWorkspaceStore.getState().cancelPendingRun()}
        />
      ) : null}

      <StatusBar
        activePanel={activePanel}
        panels={toolPanels}
        hints={
          isHistoricPreview
            ? [
                { key: "Tab/Shift+Tab", label: "switch" },
                { key: "Ctrl+1-6", label: "jump" },
                { key: "Enter", label: "preview" },
                { key: "Ctrl+C", label: "exit preview" },
                { key: "ESC", label: "back" },
                { key: "Ctrl+Q", label: "quit" },
              ]
            : [
                { key: "Tab/Shift+Tab", label: "switch" },
                { key: "Ctrl+1-6", label: "jump" },
                ...(activePanel === "drafts"
                  ? [
                      { key: "Enter", label: "apply draft" },
                      { key: "d", label: "archive" },
                    ]
                  : []),
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
