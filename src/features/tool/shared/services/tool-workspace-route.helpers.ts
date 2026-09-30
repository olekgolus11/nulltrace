import { ToolName } from "../types/tool-screen.types";

export function isToolWorkspaceForRoute(
  activeToolName: string | null,
  activeSessionId: string | null,
  requestedToolName: ToolName,
  requestedSessionId: string | null,
): boolean {
  return activeToolName === requestedToolName && activeSessionId === requestedSessionId;
}

export function shouldInitializeToolWorkspace(
  activeToolName: string | null,
  activeSessionId: string | null,
  requestedToolName: ToolName,
  requestedSessionId: string | null,
  isBusy: boolean,
): boolean {
  return !isBusy && !isToolWorkspaceForRoute(activeToolName, activeSessionId, requestedToolName, requestedSessionId);
}
