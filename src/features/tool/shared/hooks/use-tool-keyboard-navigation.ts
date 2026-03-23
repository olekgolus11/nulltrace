import { useKeyboard } from "@opentui/react";
import { useToolWorkspaceStore } from "../store/tool-workspace.store";
import { toolRegistry } from "../registry/tool-registry";

export function useToolKeyboardNavigation(onBack: () => void) {
  useKeyboard((key) => {
    const state = useToolWorkspaceStore.getState();

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

    const toolModule = state.toolId ? toolRegistry[state.toolId] : undefined;
    if (!toolModule?.handleFormKey) {
      return;
    }

    toolModule.handleFormKey(key, state, {
      updateToolData: (updater) => state.updateToolData(updater),
      syncGeneratedCommand: () => useToolWorkspaceStore.getState().syncGeneratedCommand(),
    });
  });
}
