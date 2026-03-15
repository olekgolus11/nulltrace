import { ChatMessageData } from "../../chat/model/chat.types";

export type ToolPanel = "chat" | "form" | "command" | "output";

export type NmapTiming = "T2" | "T3" | "T4" | "T5";

export type NmapFieldId =
  | "target"
  | "ports"
  | "timing"
  | "serviceDetection"
  | "osDetection"
  | "defaultScripts"
  | "aggressive"
  | "extraArgs";

export interface NmapFormState {
  target: string;
  ports: string;
  timing: NmapTiming;
  serviceDetection: boolean;
  osDetection: boolean;
  defaultScripts: boolean;
  aggressive: boolean;
  extraArgs: string;
}

export interface ToolScreenProps {
  toolId: string;
  toolName: string;
  targetUrl: string;
  onBack: () => void;
}

export interface ToolWorkspaceProps {
  toolId: string;
  toolName: string;
  activePanel: ToolPanel;
  selectedFormField: number;
  nmapForm: NmapFormState;
  commandInput: string;
  generatedCommand: string;
  commandSource: "generated" | "manual";
  outputLines: string[];
  executionStatus: "idle" | "running" | "success" | "error";
  lastExitCode: number | null;
  onNmapFieldChange: (
    field: keyof NmapFormState,
    value: string | boolean | NmapTiming,
  ) => void;
  onCommandChange: (value: string) => void;
  onRunCommand: () => void;
  formHeight: number;
  commandHeight: number;
  outputHeight: number;
}

export interface ToolDefinition {
  id: string;
  name: string;
  description: string;
  createInitialForm: (targetUrl: string) => NmapFormState;
  buildCommand: (form: NmapFormState) => string;
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

export interface ToolState {
  activePanel: ToolPanel;
  selectedFormField: number;
  chatInput: string;
  chatMessages: ChatMessageData[];
  nmapForm: NmapFormState;
  commandInput: string;
  commandSource: "generated" | "manual";
  outputLines: string[];
  executionStatus: "idle" | "running" | "success" | "error";
  lastExitCode: number | null;
}
