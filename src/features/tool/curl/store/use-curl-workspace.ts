import { useToolWorkspaceStore } from "../../shared/store/tool-workspace.store";
import { getOwnedToolWorkspaceData } from "../../shared/store/tool-workspace-data.helpers";
import { getCurlFieldOrder } from "../config/curl.config";
import { curlCommandService } from "../services/curl-command.service";
import {
  CurlFieldId,
  CurlFormState,
  CurlToolData,
} from "../types/curl.types";

function getCurlToolData(
  activeToolName: string | null,
  toolData: unknown,
  targetUrl: string,
): CurlToolData {
  return getOwnedToolWorkspaceData(
    activeToolName,
    "curl",
    toolData,
    () => curlCommandService.createInitialToolData(targetUrl),
  );
}

export function useCurlWorkspace() {
  const state = useToolWorkspaceStore();
  const toolData = getCurlToolData(state.toolName, state.toolData, state.targetUrl);

  const updateCurlToolData = (updater: (current: CurlToolData) => CurlToolData) => {
    if (useToolWorkspaceStore.getState().toolName !== "curl") return;
    state.updateToolData((current) => {
      const currentState = useToolWorkspaceStore.getState();
      return updater(
        getCurlToolData(currentState.toolName, current, currentState.targetUrl),
      );
    });
    state.syncGeneratedCommand();
  };

  const setField = <K extends keyof CurlFormState>(
    field: K,
    value: CurlFormState[K],
  ) => {
    const currentState = useToolWorkspaceStore.getState();
    const currentToolData = getCurlToolData(
      currentState.toolName,
      currentState.toolData,
      currentState.targetUrl,
    );
    if (currentToolData.form[field] === value) return;
    updateCurlToolData((current) =>
      curlCommandService.setField(current, field, value),
    );
  };

  const selectField = (field: CurlFieldId) => {
    if (useToolWorkspaceStore.getState().toolName !== "curl") return;
    state.updateToolData((current) => {
      const currentState = useToolWorkspaceStore.getState();
      const currentToolData = getCurlToolData(
        currentState.toolName,
        current,
        currentState.targetUrl,
      );
      const fieldOrder: readonly CurlFieldId[] = getCurlFieldOrder(
        currentToolData.authentication.isAvailable,
      );
      const selectedField = fieldOrder.indexOf(field);
      return selectedField < 0
        ? currentToolData
        : { ...currentToolData, selectedField };
    });
  };

  return {
    ...state,
    toolData,
    setField,
    selectField,
    cycleMethod: (delta: -1 | 1) =>
      updateCurlToolData((current) => curlCommandService.cycleMethod(current, delta)),
    cycleBodyMode: () =>
      updateCurlToolData((current) => curlCommandService.cycleBodyMode(current)),
    toggleAuthenticatedContext: () =>
      updateCurlToolData((current) =>
        curlCommandService.toggleAuthenticatedContext(current),
      ),
  };
}
