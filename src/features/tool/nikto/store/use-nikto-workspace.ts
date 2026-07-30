import { useToolWorkspaceStore } from "../../shared/store/tool-workspace.store";
import { niktoCommandService } from "../services/nikto-command.service";
import { NiktoFormState, NiktoToolData } from "../types/nikto.types";

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

  return { ...state, toolData, setField };
}
