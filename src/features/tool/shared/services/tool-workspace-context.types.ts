import {
  CommandSource,
  ExecutionStatus,
  ToolData,
  ToolName,
  ToolPanel,
} from "../types/tool-screen.types";

export interface ToolWorkspaceContextInput {
  sessionId: string;
  toolName: ToolName;
  activePanel: ToolPanel;
  commandInput: string;
  generatedCommand: string;
  commandSource: CommandSource;
  executionStatus: ExecutionStatus;
  currentToolRunId: string | null;
  selectedHistoryRunId: string | null;
  isHistoricPreview: boolean;
  toolData: ToolData;
}

export interface ToolWorkspaceContextSnapshot extends ToolWorkspaceContextInput {
  updatedAt: string;
}
