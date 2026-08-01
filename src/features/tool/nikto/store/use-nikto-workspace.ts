import { useToolWorkspaceStore } from "../../shared/store/tool-workspace.store";
import { getOwnedToolWorkspaceData } from "../../shared/store/tool-workspace-data.helpers";
import { niktoCommandService } from "../services/nikto-command.service";
import {
  NiktoFormState,
  NiktoProfile,
  NiktoToolData,
  NiktoTuningCode,
} from "../types/nikto.types";

function getNiktoToolData(
  activeToolName: string | null,
  value: unknown,
  targetUrl: string,
): NiktoToolData {
  return getOwnedToolWorkspaceData(
    activeToolName,
    "nikto",
    value,
    () => niktoCommandService.createInitialToolData(targetUrl),
  );
}

export function useNiktoWorkspace() {
  const state = useToolWorkspaceStore();
  const toolData = getNiktoToolData(state.toolName, state.toolData, state.targetUrl);
  const setField = (field: keyof NiktoFormState, value: string) => {
    if (useToolWorkspaceStore.getState().toolName !== "nikto") return;
    state.updateToolData((current) =>
      niktoCommandService.setField(
        getNiktoToolData("nikto", current, state.targetUrl),
        field,
        value,
      ),
    );
    state.syncGeneratedCommand();
  };
  const setProfile = (profile: NiktoProfile) => {
    if (useToolWorkspaceStore.getState().toolName !== "nikto") return;
    state.updateToolData((current) =>
      niktoCommandService.setProfile(
        getNiktoToolData("nikto", current, state.targetUrl),
        profile,
      ),
    );
    state.syncGeneratedCommand();
  };
  const toggleTuning = (code: NiktoTuningCode) => {
    if (useToolWorkspaceStore.getState().toolName !== "nikto") return;
    state.updateToolData((current) =>
      niktoCommandService.toggleTuning(
        getNiktoToolData("nikto", current, state.targetUrl),
        code,
      ),
    );
    state.syncGeneratedCommand();
  };

  const toggleAuthenticatedContext = () => {
    if (useToolWorkspaceStore.getState().toolName !== "nikto") return;
    state.updateToolData((current) =>
      niktoCommandService.toggleAuthenticatedContext(
        getNiktoToolData("nikto", current, state.targetUrl),
      ),
    );
    state.syncGeneratedCommand();
  };

  return {
    ...state,
    toolData,
    setField,
    setProfile,
    toggleTuning,
    toggleAuthenticatedContext,
  };
}
