import { ComponentType } from "react";
import { ChatMessageData } from "../../../chat/model/chat.types";

export type ToolName = "nmap" | "nuclei" | "ffuf" | "sqlmap" | "zap" | "nikto";

export type ToolPanel = "chat" | "form" | "command" | "output";

export type ExecutionStatus = "idle" | "running" | "success" | "error";

export type CommandSource = "generated" | "manual";

export interface ToolCatalogItem {
  id: ToolName;
  name: string;
  description: string;
  icon: string;
}

export interface ToolScreenProps {
  toolName: ToolName;
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
  toolName: string | null;
  targetUrl: string;
  activePanel: ToolPanel;
  isHelpOpen: boolean;
  chatInput: string;
  chatMessages: ChatMessageData[];
  commandInput: string;
  generatedCommand: string;
  commandSource: CommandSource;
  outputLines: string[];
  executionStatus: ExecutionStatus;
  lastExitCode: number | null;
  toolData: unknown;
}

export interface ToolKeyboardApi {
  updateToolData: (updater: (current: unknown) => unknown) => void;
  syncGeneratedCommand: () => void;
  toggleHelp: () => void;
}

export interface ToolKeyEvent {
  name?: string;
  ctrl?: boolean;
}

export interface ToolModule {
  id: string;
  name: string;
  description: string;
  Workspace: ComponentType;
  createInitialToolData: (targetUrl: string) => ToolData;
  buildGeneratedCommand: (toolData: unknown) => string;
  handleFormKey?: (
    key: ToolKeyEvent,
    state: ToolWorkspaceStoreState,
    api: ToolKeyboardApi,
  ) => boolean;
}

export interface ToolData {
  form: Record<string, unknown>;
  selectedField: number;
}

export interface ToolHelpContent {
  title: string;
  summary: string;
  commandEffect: string;
  guidance: string;
}
