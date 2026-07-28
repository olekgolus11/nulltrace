import { ComponentType } from "react";
import {
  ToolRunArtifactInput,
  ToolRunArtifactRecord,
  ToolRunDetail,
  ToolRunSummary,
} from "../../../session/model/session.repository.types";

export type ToolName = "nmap" | "nuclei" | "ffuf" | "sqlmap" | "zap" | "nikto";

export type ToolPanel = "drafts" | "chat" | "form" | "command" | "output" | "history";

export type ExecutionStatus = "idle" | "running" | "success" | "cancelled" | "error";

export type CommandSource = "generated" | "manual";

export interface ToolWorkspaceStoreState {
  toolName: string | null;
  sessionId: string | null;
  targetUrl: string;
  activePanel: ToolPanel;
  isHelpOpen: boolean;
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
  pendingRunConfirmation: ToolPendingRunConfirmation | null;
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
  getRunConfirmation?: (
    command: string,
    toolData: unknown,
  ) => ToolRunConfirmation | null;
  handleFormKey?: (
    key: ToolKeyEvent,
    state: ToolWorkspaceStoreState,
    api: ToolKeyboardApi,
  ) => boolean;
  prepareCommandForRun?: (
    options: ToolPrepareCommand,
  ) => string | ToolPreparedCommand | Promise<string | ToolPreparedCommand>;
  redactCommandForPersistence?: (command: string) => string;
  collectArtifacts?: (options: ToolRunCompleted) => Promise<ToolRunArtifactInput[]>;
  processSavedArtifacts?: (options: ToolArtifactsSaved) => void;
}

export interface ToolRunConfirmation {
  title: string;
  message: string;
  confirmationKey: string;
}

export interface ToolPendingRunConfirmation extends ToolRunConfirmation {
  command: string;
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
  targetUrl?: string;
  toolData?: unknown;
}

export interface ToolPreparedCommand {
  command: string;
  cleanup?: () => void;
  prepareArtifacts?: () => void | Promise<void>;
  redactOutput?: (content: string) => string;
  redactArtifact?: (content: string) => string;
}

export interface ToolRunCompleted {
  sessionId: string | null;
  toolRunId: string | null;
  command?: string;
  status: ExecutionStatus;
  exitCode: number | null;
  toolData?: unknown;
  redactOutput?: (content: string) => string;
  redactArtifact?: (content: string) => string;
}

export interface ToolArtifactsSaved {
  sessionId: string | null;
  artifacts: ToolRunArtifactRecord[];
}
