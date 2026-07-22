import {
  existsSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  renameSync,
  unlinkSync,
  writeFileSync,
} from "node:fs";
import { join } from "node:path";
import { getAppDataDirectory } from "../../../session/services/session-database";
import { redactNucleiCommandForPersistence } from "../../nuclei/services/nuclei-command-redaction";
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

function getTemporaryContextPath(sessionId: string) {
  return join(getContextDirectory(), `${encodeURIComponent(sessionId)}.${process.pid}.tmp`);
}

function isObject(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function isToolData(value: unknown): value is ToolData {
  return isObject(value) && isObject(value.form) && typeof value.selectedField === "number";
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
    (selectedHistoryRunId !== null && typeof selectedHistoryRunId !== "string") ||
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
    const sanitizedInput =
      input.toolName === "nuclei"
        ? {
            ...input,
            commandInput: redactNucleiCommandForPersistence(input.commandInput),
            generatedCommand: redactNucleiCommandForPersistence(input.generatedCommand),
            toolData: {
              ...input.toolData,
              form: {
                ...input.toolData.form,
                ...(typeof input.toolData.form.extraArgs === "string"
                  ? {
                      extraArgs: redactNucleiCommandForPersistence(input.toolData.form.extraArgs),
                    }
                  : {}),
              },
            },
          }
        : input;
    const snapshot: ToolWorkspaceContextSnapshot = {
      ...sanitizedInput,
      updatedAt: new Date().toISOString(),
    };

    const temporaryPath = getTemporaryContextPath(input.sessionId);
    writeFileSync(temporaryPath, `${JSON.stringify(snapshot, null, 2)}\n`, "utf8");
    renameSync(temporaryPath, getContextPath(input.sessionId));

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

  clearAllActiveWorkspaces() {
    const contextDirectory = getContextDirectory();
    if (!existsSync(contextDirectory)) {
      return;
    }

    for (const fileName of readdirSync(contextDirectory)) {
      if (!fileName.endsWith(".json") && !fileName.endsWith(".tmp")) {
        continue;
      }

      unlinkSync(join(contextDirectory, fileName));
    }
  },
};
