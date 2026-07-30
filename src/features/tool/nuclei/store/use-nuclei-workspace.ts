import { useToolWorkspaceStore } from "../../shared/store/tool-workspace.store";
import { getOwnedToolWorkspaceData } from "../../shared/store/tool-workspace-data.helpers";
import { nucleiCommandService } from "../services/nuclei-command.service";
import { NucleiFormState, NucleiSeverityPreset, NucleiToolData } from "../types/nuclei.types";

function getNucleiToolData(
  activeToolName: string | null,
  toolData: unknown,
  targetUrl: string,
): NucleiToolData {
  return getOwnedToolWorkspaceData(
    activeToolName,
    "nuclei",
    toolData,
    () => nucleiCommandService.createInitialToolData(targetUrl),
  );
}

export function useNucleiWorkspace() {
  const activePanel = useToolWorkspaceStore((state) => state.activePanel);
  const activeToolName = useToolWorkspaceStore((state) => state.toolName);
  const activeToolData = useToolWorkspaceStore((state) => state.toolData);
  const targetUrl = useToolWorkspaceStore((state) => state.targetUrl);
  const toolData = getNucleiToolData(
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

  const setField = (field: keyof NucleiFormState, value: string | NucleiSeverityPreset) => {
    if (useToolWorkspaceStore.getState().toolName !== "nuclei") {
      return;
    }
    updateToolData((current) => {
      const state = useToolWorkspaceStore.getState();
      return nucleiCommandService.setField(
        getNucleiToolData(state.toolName, current, state.targetUrl),
        field,
        value,
      );
    });
    syncGeneratedCommand();
  };

  const toggleAuthenticatedContext = () => {
    if (useToolWorkspaceStore.getState().toolName !== "nuclei") {
      return;
    }
    updateToolData((current) => {
      const state = useToolWorkspaceStore.getState();
      return nucleiCommandService.toggleAuthenticatedContext(
        getNucleiToolData(state.toolName, current, state.targetUrl),
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
