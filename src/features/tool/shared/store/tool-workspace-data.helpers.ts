import { ToolData, ToolName } from "../types/tool-screen.types";

export function getOwnedToolWorkspaceData<ToolDataType extends ToolData>(
  activeToolName: string | null,
  expectedToolName: ToolName,
  toolData: unknown,
  createInitialToolData: () => ToolDataType,
): ToolDataType {
  if (activeToolName !== expectedToolName || !toolData) {
    return createInitialToolData();
  }

  return toolData as ToolDataType;
}
