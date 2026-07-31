import { useToolWorkspaceStore } from "../../shared/store/tool-workspace.store";
import { niktoCommandService } from "../services/nikto-command.service";
import {
  NiktoFormState,
  NiktoProfile,
  NiktoToolData,
  NiktoTuningCode,
} from "../types/nikto.types";

function getNiktoToolData(value: unknown): NiktoToolData {
  return (value as NiktoToolData | null) ?? niktoCommandService.createInitialToolData("");
}

export function useNiktoWorkspace() {
  const state = useToolWorkspaceStore();
  const toolData = getNiktoToolData(state.toolData);
  const setField = (field: keyof NiktoFormState, value: string) => {
    state.updateToolData((current) =>
      niktoCommandService.setField(getNiktoToolData(current), field, value),
    );
    state.syncGeneratedCommand();
  };
  const setProfile = (profile: NiktoProfile) => {
    state.updateToolData((current) =>
      niktoCommandService.setProfile(getNiktoToolData(current), profile),
    );
    state.syncGeneratedCommand();
  };
  const toggleTuning = (code: NiktoTuningCode) => {
    state.updateToolData((current) =>
      niktoCommandService.toggleTuning(getNiktoToolData(current), code),
    );
    state.syncGeneratedCommand();
  };

  return { ...state, toolData, setField, setProfile, toggleTuning };
}
