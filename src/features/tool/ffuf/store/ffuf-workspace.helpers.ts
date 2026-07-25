import { createInitialFfufToolData } from "../services/ffuf-command.helpers";
import { FfufToolData } from "../types/ffuf.types";

export function getFfufWorkspaceToolData(toolData: unknown): FfufToolData {
  return (toolData as FfufToolData | null) ?? createInitialFfufToolData("");
}
