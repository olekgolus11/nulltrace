import {
  existsSync,
  mkdirSync,
  readFileSync,
  unlinkSync,
  writeFileSync,
} from "node:fs";
import { join } from "node:path";
import { getAppDataDirectory } from "../../../session/services/session-database";
import {
  CommandSource,
  ExecutionStatus,
  ToolData,
  ToolName,
  ToolPanel,
} from "../types/tool-screen.types";

export interface ToolWorkspaceContextSnapshot {
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
  updatedAt: string;
}

interface ToolWorkspaceContextInput {
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

function getContextDirectory() {
  return join(getAppDataDirectory(), "tool-workspace-context");
}

function getContextPath(sessionId: string) {
  return join(getContextDirectory(), `${encodeURIComponent(sessionId)}.json`);
}

function isObject(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function isToolData(value: unknown): value is ToolData {
  return (
    isObject(value) &&
    isObject(value.form) &&
    typeof value.selectedField === "number"
  );
}

function readSnapshot(value: unknown): ToolWorkspaceContextSnapshot | null {
  if (!isObject(value) || !isToolData(value.toolData)) {
    return null;
  }

  const {
    sessionId,
    toolName,
    activePanel,
    commandInput,
    generatedCommand,
    commandSource,
    executionStatus,
    currentToolRunId,
    selectedHistoryRunId,
    isHistoricPreview,
    updatedAt,
  } = value;

  if (
    typeof sessionId !== "string" ||
    typeof toolName !== "string" ||
    typeof activePanel !== "string" ||
    typeof commandInput !== "string" ||
    typeof generatedCommand !== "string" ||
    typeof commandSource !== "string" ||
    typeof executionStatus !== "string" ||
    (currentToolRunId !== null && typeof currentToolRunId !== "string") ||
    (selectedHistoryRunId !== null &&
      typeof selectedHistoryRunId !== "string") ||
    typeof isHistoricPreview !== "boolean" ||
    typeof updatedAt !== "string"
  ) {
    return null;
  }

  return {
    sessionId,
    toolName: toolName as ToolName,
    activePanel: activePanel as ToolPanel,
    commandInput,
    generatedCommand,
    commandSource: commandSource as CommandSource,
    executionStatus: executionStatus as ExecutionStatus,
    currentToolRunId,
    selectedHistoryRunId,
    isHistoricPreview,
    toolData: value.toolData,
    updatedAt,
  };
}

export const toolWorkspaceContextService = {
  saveActiveWorkspace(input: ToolWorkspaceContextInput) {
    mkdirSync(getContextDirectory(), { recursive: true });
    const snapshot: ToolWorkspaceContextSnapshot = {
      ...input,
      updatedAt: new Date().toISOString(),
    };

    writeFileSync(
      getContextPath(input.sessionId),
      `${JSON.stringify(snapshot, null, 2)}\n`,
      "utf8",
    );

    return snapshot;
  },

  getActiveWorkspace(sessionId: string) {
    const contextPath = getContextPath(sessionId);
    if (!existsSync(contextPath)) {
      return null;
    }

    try {
      return readSnapshot(JSON.parse(readFileSync(contextPath, "utf8")));
    } catch {
      return null;
    }
  },

  clearActiveWorkspace(sessionId: string) {
    const contextPath = getContextPath(sessionId);
    if (!existsSync(contextPath)) {
      return;
    }

    unlinkSync(contextPath);
  },
};
