import { createInitialFfufToolData } from "../services/ffuf-command.helpers";
import { FfufToolData } from "../types/ffuf.types";
import { getOwnedToolWorkspaceData } from "../../shared/store/tool-workspace-data.helpers";

export function getFfufWorkspaceToolData(
  activeToolName: string | null,
  toolData: unknown,
  targetUrl: string,
): FfufToolData {
  return getOwnedToolWorkspaceData(
    activeToolName,
    "ffuf",
    toolData,
    () => createInitialFfufToolData(targetUrl),
  );
}
