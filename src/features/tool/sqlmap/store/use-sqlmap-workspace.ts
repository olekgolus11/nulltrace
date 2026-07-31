import { useToolWorkspaceStore } from "../../shared/store/tool-workspace.store";
import { sqlmapCommandService } from "../services/sqlmap-command.service";
import { SqlmapFormState, SqlmapToolData } from "../types/sqlmap.types";

function getSqlmapToolData(value: unknown): SqlmapToolData {
  return (value as SqlmapToolData | null) ?? sqlmapCommandService.createInitialToolData("");
}

export function useSqlmapWorkspace() {
  const state = useToolWorkspaceStore();
  const toolData = getSqlmapToolData(state.toolData);
  const setField = (field: keyof SqlmapFormState, value: string) => {
    state.updateToolData((current) =>
      sqlmapCommandService.setField(getSqlmapToolData(current), field, value),
    );
    state.syncGeneratedCommand();
  };

  return { ...state, toolData, setField };
}
