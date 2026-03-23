import { ChatMessageData } from "../../../chat/model/chat.types";

export type ToolPanel = "chat" | "form" | "command" | "output";

export type ExecutionStatus = "idle" | "running" | "success" | "error";

export type CommandSource = "generated" | "manual";

export interface ToolScreenProps {
  toolId: string;
  toolName: string;
  targetUrl: string;
  onBack: () => void;
}

export interface UseToolLayoutProps {
  width: number;
  height: number;
}

export interface UseToolLayoutResult {
  contentHeight: number;
  leftPanelWidth: number;
  rightPanelWidth: number;
  formPanelHeight: number;
  commandPanelHeight: number;
  outputPanelHeight: number;
  outputScrollHeight: number;
}

export interface ToolWorkspaceStoreState {
  toolId: string | null;
  targetUrl: string;
  activePanel: ToolPanel;
  chatInput: string;
  chatMessages: ChatMessageData[];
  commandInput: string;
  commandSource: CommandSource;
  outputLines: string[];
  executionStatus: ExecutionStatus;
  lastExitCode: number | null;
  toolData: unknown;
}
