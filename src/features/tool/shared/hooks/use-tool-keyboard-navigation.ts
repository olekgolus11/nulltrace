import { useKeyboard } from "@opentui/react";
import { useToolWorkspaceStore } from "../store/tool-workspace.store";
import { toolRegistry } from "../registry/tool-registry";

export function useToolKeyboardNavigation(onBack: () => void) {
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
      state.cyclePanel();
      return;
    }

    if (key.ctrl && key.name === "r") {
      void state.runCommand();
      return;
    }

    if (key.ctrl && key.name === "g") {
      state.resetCommandToGenerated();
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
