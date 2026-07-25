import { useToolWorkspaceStore } from "../../shared/store/tool-workspace.store";
import {
  setFfufContentDiscoveryField,
} from "../services/ffuf-command.helpers";
import { getFfufWorkspaceToolData } from "./ffuf-workspace.helpers";
import { FfufContentDiscoveryFormState } from "../types/ffuf.types";

export function useFfufWorkspace() {
  const activePanel = useToolWorkspaceStore((state) => state.activePanel);
  const toolData = useToolWorkspaceStore((state) => getFfufWorkspaceToolData(state.toolData));
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

  const setField = (field: keyof FfufContentDiscoveryFormState, value: string | boolean) => {
    updateToolData((current) =>
      setFfufContentDiscoveryField(getFfufWorkspaceToolData(current), field, value),
    );
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
    setManualCommandInput,
    runCommand,
  };
}
