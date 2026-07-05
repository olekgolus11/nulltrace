import { ScrollBoxRenderable } from "@opentui/core";
import { useKeyboard } from "@opentui/react";
import { RefObject } from "react";
import { useToolWorkspaceStore } from "../store/tool-workspace.store";
import { toolPanels, toolRegistry } from "../registry/tool-registry";
import { getPanelByShortcut } from "../../../../shared/model/panel-navigation";
import { ActiveSessionConversation } from "../../../chat/services/session-conversation.service";

interface UseToolKeyboardNavigationProps {
  onBack: () => void;
  actionDraftScrollRef: RefObject<ScrollBoxRenderable | null>;
  historyScrollRef: RefObject<ScrollBoxRenderable | null>;
  onMoveActionDraftSelection: (direction: -1 | 1) => void;
  onApplySelectedActionDraft: () => void;
  onArchiveSelectedActionDraft: () => void;
  conversations: ActiveSessionConversation[];
  activeConversationId: string | null;
  isConversationNavigationDisabled: boolean;
  onSelectConversation: (conversationId: string) => void;
  onCreateConversation: () => void;
  onArchiveActiveConversation: () => void;
}

function clamp(value: number, min: number, max: number) {
  return Math.max(min, Math.min(max, value));
}

export function useToolKeyboardNavigation({
  onBack,
  actionDraftScrollRef,
  historyScrollRef,
  onMoveActionDraftSelection,
  onApplySelectedActionDraft,
  onArchiveSelectedActionDraft,
  conversations,
  activeConversationId,
  isConversationNavigationDisabled,
  onSelectConversation,
  onCreateConversation,
  onArchiveActiveConversation,
}: UseToolKeyboardNavigationProps) {
  useKeyboard((key) => {
    const state = useToolWorkspaceStore.getState();

    if (state.isHelpOpen) {
      if (key.name === "escape" || (key.ctrl && key.name === "h")) {
        state.closeHelp();
      }
      return;
    }

    if (key.name === "escape") {
      onBack();
      return;
    }

    if (key.name === "tab") {
      state.cyclePanel(key.shift ? -1 : 1);
      return;
    }

    const shortcutPanel = getPanelByShortcut(toolPanels, key.name, key.ctrl);
    if (shortcutPanel) {
      state.setActivePanel(shortcutPanel);
      return;
    }

    if (
      state.activePanel === "chat" &&
      key.ctrl &&
      !isConversationNavigationDisabled
    ) {
      if (key.name === "n") {
        onCreateConversation();
        return;
      }

      if (key.name === "d" && activeConversationId) {
        onArchiveActiveConversation();
        return;
      }

      if (key.name === "left" || key.name === "right") {
        const activeIndex = conversations.findIndex(
          (conversation) =>
            conversation.attachment.opencodeConversationId ===
            activeConversationId,
        );
        const nextIndex = clamp(
          activeIndex + (key.name === "left" ? -1 : 1),
          0,
          Math.max(0, conversations.length - 1),
        );
        const nextConversation = conversations[nextIndex];
        if (nextConversation && nextIndex !== activeIndex) {
          onSelectConversation(
            nextConversation.attachment.opencodeConversationId,
          );
        }
        return;
      }
    }

    if (state.activePanel === "drafts") {
      if (key.name === "up") {
        actionDraftScrollRef.current?.scrollBy(-3, "step");
        onMoveActionDraftSelection(-1);
        return;
      }

      if (key.name === "down") {
        actionDraftScrollRef.current?.scrollBy(3, "step");
        onMoveActionDraftSelection(1);
        return;
      }

      if (key.name === "return" || key.name === "enter") {
        onApplySelectedActionDraft();
        return;
      }

      if (key.name === "d") {
        onArchiveSelectedActionDraft();
        return;
      }
    }

    if (state.activePanel === "history") {
      if (key.name === "up") {
        historyScrollRef.current?.scrollBy(-4, "step");
        state.moveHistorySelection(-1);
        return;
      }

      if (key.name === "down") {
        historyScrollRef.current?.scrollBy(4, "step");
        state.moveHistorySelection(1);
        return;
      }

      if (key.name === "return" || key.name === "enter") {
        if (state.selectedHistoryRunId) {
          state.selectHistoryRun(state.selectedHistoryRunId);
        }
        return;
      }

      if (key.ctrl && key.name === "r") {
        state.rerunSelectedHistoryRun();
        return;
      }
    }

    if (state.isHistoricPreview) {
      if (key.ctrl && key.name === "c") {
        state.exitHistoricPreview();
        return;
      }

      if (key.ctrl && key.name === "r") {
        return;
      }

      if (key.ctrl && key.name === "g") {
        return;
      }
    }

    if (key.ctrl && key.name === "r") {
      void state.runCommand();
      return;
    }

    if (key.ctrl && key.name === "g") {
      state.resetCommandToGenerated();
      return;
    }

    if (key.ctrl && key.name === "c" && state.executionStatus === "running") {
      state.stopCommand();
      return;
    }

    const toolModule = state.toolName
      ? toolRegistry[state.toolName]
      : undefined;
    if (!toolModule?.handleFormKey) {
      return;
    }

    toolModule.handleFormKey(key, state, {
      updateToolData: (updater) => state.updateToolData(updater),
      syncGeneratedCommand: () =>
        useToolWorkspaceStore.getState().syncGeneratedCommand(),
      toggleHelp: () => useToolWorkspaceStore.getState().toggleHelp(),
    });
  });
}
