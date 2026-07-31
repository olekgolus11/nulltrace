import { useToolWorkspaceStore } from "../../shared/store/tool-workspace.store";
import {
  setFfufContentDiscoveryField,
  setFfufParameterDiscoveryField,
  setFfufValueFuzzingField,
} from "../services/ffuf-command.helpers";
import { toggleFfufAuthenticatedContext } from "../services/ffuf-authentication.helpers";
import { getFfufWorkspaceToolData } from "./ffuf-workspace.helpers";
import { FfufFieldId } from "../types/ffuf.types";

export function useFfufWorkspace() {
  const activePanel = useToolWorkspaceStore((state) => state.activePanel);
  const activeToolName = useToolWorkspaceStore((state) => state.toolName);
  const activeToolData = useToolWorkspaceStore((state) => state.toolData);
  const targetUrl = useToolWorkspaceStore((state) => state.targetUrl);
  const toolData = getFfufWorkspaceToolData(
    activeToolName,
    activeToolData,
    targetUrl,
  );
  const commandInput = useToolWorkspaceStore((state) => state.commandInput);
  const generatedCommand = useToolWorkspaceStore((state) => state.generatedCommand);
  const commandSource = useToolWorkspaceStore((state) => state.commandSource);
  const isHelpOpen = useToolWorkspaceStore((state) => state.isHelpOpen);
  const setActivePanel = useToolWorkspaceStore((state) => state.setActivePanel);
  const executionStatus = useToolWorkspaceStore((state) => state.executionStatus);
  const lastExitCode = useToolWorkspaceStore((state) => state.lastExitCode);
  const outputLines = useToolWorkspaceStore((state) => state.outputLines);
  const selectedHistoryRun = useToolWorkspaceStore((state) => state.selectedHistoryRun);
  const isHistoricPreview = useToolWorkspaceStore((state) => state.isHistoricPreview);
  const setManualCommandInput = useToolWorkspaceStore((state) => state.setManualCommandInput);
  const runCommand = useToolWorkspaceStore((state) => state.runCommand);
  const updateToolData = useToolWorkspaceStore((state) => state.updateToolData);
  const syncGeneratedCommand = useToolWorkspaceStore((state) => state.syncGeneratedCommand);

  const setField = (field: Exclude<FfufFieldId, "mode">, value: string | boolean) => {
    if (useToolWorkspaceStore.getState().toolName !== "ffuf") {
      return;
    }
    updateToolData((current) => {
      const state = useToolWorkspaceStore.getState();
      const toolData = getFfufWorkspaceToolData(state.toolName, current, state.targetUrl);
      if (toolData.mode === "value_fuzzing") {
        return setFfufValueFuzzingField(
          toolData,
          field as keyof typeof toolData.form,
          String(value),
        );
      }
      if (toolData.mode === "parameter_discovery") {
        return setFfufParameterDiscoveryField(
          toolData,
          field as keyof typeof toolData.form,
          String(value),
        );
      }
      return setFfufContentDiscoveryField(
        toolData,
        field as keyof typeof toolData.form,
        value,
      );
    });
    syncGeneratedCommand();
  };
  const toggleAuthenticatedContext = () => {
    if (useToolWorkspaceStore.getState().toolName !== "ffuf") {
      return;
    }
    updateToolData((current) => {
      const state = useToolWorkspaceStore.getState();
      return toggleFfufAuthenticatedContext(
        getFfufWorkspaceToolData(state.toolName, current, state.targetUrl),
      );
    });
    syncGeneratedCommand();
  };

  return {
    activePanel,
    toolData,
    commandInput,
    generatedCommand,
    commandSource,
    isHelpOpen,
    setActivePanel,
    executionStatus,
    lastExitCode,
    outputLines,
    selectedHistoryRun,
    isHistoricPreview,
    setField,
    toggleAuthenticatedContext,
    setManualCommandInput,
    runCommand,
  };
}
