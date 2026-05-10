import { ComponentType } from "react";
import { ChatMessageData } from "../../../chat/model/chat.types";
import {
  ToolRunArtifactInput,
  ToolRunDetail,
  ToolRunSummary,
} from "../../../session/model/session.repository.types";

export type ToolName = "nmap" | "nuclei" | "ffuf" | "sqlmap" | "zap" | "nikto";

export type ToolPanel = "chat" | "form" | "command" | "output" | "history";

export type ExecutionStatus =
  | "idle"
  | "running"
  | "success"
  | "cancelled"
  | "error";

export type CommandSource = "generated" | "manual";

export interface ToolCatalogItem {
  id: ToolName;
  name: string;
  description: string;
  icon: string;
}

export interface ToolScreenProps {
  toolName: ToolName;
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
  workspacePanelWidth: number;
  historyPanelWidth: number;
  formPanelHeight: number;
  commandPanelHeight: number;
  outputPanelHeight: number;
  outputScrollHeight: number;
}

export interface ToolWorkspaceStoreState {
  toolName: string | null;
  sessionId: string | null;
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
  currentToolRunId: string | null;
  historyRuns: ToolRunSummary[];
  selectedHistoryRunId: string | null;
  selectedHistoryRun: ToolRunDetail | null;
  isHistoricPreview: boolean;
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
  prepareCommandForRun?: (options: ToolPrepareCommand) => string;
  collectArtifacts?: (
    options: ToolRunCompleted,
  ) => Promise<ToolRunArtifactInput[]>;
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

export interface ToolPrepareCommand {
  command: string;
  sessionId: string | null;
  toolRunId: string | null;
}

export interface ToolRunCompleted {
  sessionId: string | null;
  toolRunId: string | null;
  status: ExecutionStatus;
  exitCode: number | null;
}
