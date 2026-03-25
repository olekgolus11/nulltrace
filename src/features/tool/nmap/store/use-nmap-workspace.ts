import { useToolWorkspaceStore } from "../../shared/store/tool-workspace.store";
import { nmapCommandService } from "../services/nmap-command.service";
import { NmapFormState, NmapTiming, NmapToolData } from "../types/nmap.types";

function getNmapToolData(toolData: unknown): NmapToolData {
  return (
    (toolData as NmapToolData | null) ??
    nmapCommandService.createInitialToolData("")
  );
}

export function useNmapWorkspace() {
  const activePanel = useToolWorkspaceStore((state) => state.activePanel);
  const toolData = useToolWorkspaceStore((state) =>
    getNmapToolData(state.toolData),
  );
  const commandInput = useToolWorkspaceStore((state) => state.commandInput);
  const generatedCommand = useToolWorkspaceStore(
    (state) => state.generatedCommand,
  );
  const commandSource = useToolWorkspaceStore((state) => state.commandSource);
  const isHelpOpen = useToolWorkspaceStore((state) => state.isHelpOpen);
  const executionStatus = useToolWorkspaceStore(
    (state) => state.executionStatus,
  );
  const lastExitCode = useToolWorkspaceStore((state) => state.lastExitCode);
  const outputLines = useToolWorkspaceStore((state) => state.outputLines);
  const setManualCommandInput = useToolWorkspaceStore(
    (state) => state.setManualCommandInput,
  );
  const runCommand = useToolWorkspaceStore((state) => state.runCommand);
  const updateToolData = useToolWorkspaceStore((state) => state.updateToolData);
  const syncGeneratedCommand = useToolWorkspaceStore(
    (state) => state.syncGeneratedCommand,
  );

  const setField = (
    field: keyof NmapFormState,
    value: string | boolean | NmapTiming,
  ) => {
    updateToolData((current) =>
      nmapCommandService.setField(getNmapToolData(current), field, value),
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
    executionStatus,
    lastExitCode,
    outputLines,
    setField,
    setManualCommandInput,
    runCommand,
  };
}
