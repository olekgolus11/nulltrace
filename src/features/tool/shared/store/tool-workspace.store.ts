import { create } from "zustand";
import { ChatMessageData } from "../../../chat/model/chat.types";
import { sessionRepository } from "../../../session/services/session.repository";
import { commandRunnerService } from "../services/command-runner.service";
import {
  CommandSource,
  ExecutionStatus,
  ToolPanel,
  ToolWorkspaceStoreState,
} from "../types/tool-screen.types";
import { toolRegistry } from "../registry/tool-registry";

const PANELS: ToolPanel[] = ["chat", "form", "command", "output"];

const initialChatMessages: ChatMessageData[] = [
  {
    id: "tool-system-1",
    sender: "system",
    content:
      "Tool workspace ready. Configure a scan profile or edit the full command directly.",
    timestamp: "14:40",
  },
  {
    id: "tool-ai-1",
    sender: "ai",
    content:
      "Start with a conservative scan, then escalate with scripts or aggressive mode if you need more coverage.",
    timestamp: "14:40",
  },
];

const initialOutputLines = [
  "Awaiting command.",
  "Use the form to build a scan or edit the full command manually.",
];

const initialWorkspaceState: ToolWorkspaceStoreState = {
  toolName: null,
  sessionId: null,
  targetUrl: "",
  activePanel: "form",
  isHelpOpen: false,
  chatInput: "",
  chatMessages: initialChatMessages,
  commandInput: "",
  generatedCommand: "",
  commandSource: "generated",
  outputLines: initialOutputLines,
  executionStatus: "idle",
  lastExitCode: null,
  currentToolRunId: null,
  toolData: null,
};

function formatTime() {
  return new Date().toLocaleTimeString([], {
    hour: "2-digit",
    minute: "2-digit",
  });
}

function getNextPanel(current: ToolPanel): ToolPanel {
  const currentIndex = PANELS.indexOf(current);
  return PANELS[(currentIndex + 1) % PANELS.length]!;
}

interface ToolWorkspaceStore extends ToolWorkspaceStoreState {
  initializeWorkspace: (
    toolName: string,
    targetUrl: string,
    sessionId: string,
  ) => void;
  cyclePanel: () => void;
  setActivePanel: (panel: ToolPanel) => void;
  openHelp: () => void;
  closeHelp: () => void;
  toggleHelp: () => void;
  setChatInput: (value: string) => void;
  submitChat: () => void;
  setManualCommandInput: (value: string) => void;
  refreshGeneratedCommand: (value: string) => void;
  syncGeneratedCommand: () => void;
  resetCommandToGenerated: () => void;
  startExecution: (command: string) => void;
  appendOutput: (lines: string[], stream?: "stdout" | "stderr") => void;
  finishExecution: (status: ExecutionStatus, exitCode: number | null) => void;
  cancelExecution: () => void;
  runCommand: () => Promise<void>;
  stopCommand: () => void;
  updateToolData: (updater: (current: unknown) => unknown) => void;
}

export const useToolWorkspaceStore = create<ToolWorkspaceStore>((set, get) => ({
  ...initialWorkspaceState,

  initializeWorkspace: (toolName, targetUrl, sessionId) => {
    const toolModule = toolRegistry[toolName];
    const toolData = toolModule?.createInitialToolData(targetUrl) ?? null;
    const generatedCommand = toolModule?.buildGeneratedCommand(toolData) ?? "";

    set({
      toolName,
      sessionId,
      targetUrl,
      activePanel: "form",
      isHelpOpen: false,
      chatInput: "",
      chatMessages: initialChatMessages,
      commandInput: generatedCommand,
      generatedCommand,
      commandSource: "generated",
      outputLines: initialOutputLines,
      executionStatus: "idle",
      lastExitCode: null,
      currentToolRunId: null,
      toolData,
    });
  },

  cyclePanel: () =>
    set((state) => ({
      activePanel: getNextPanel(state.activePanel),
    })),

  setActivePanel: (panel) => set({ activePanel: panel }),

  openHelp: () => set({ isHelpOpen: true }),

  closeHelp: () => set({ isHelpOpen: false }),

  toggleHelp: () => set((state) => ({ isHelpOpen: !state.isHelpOpen })),

  setChatInput: (value) => set({ chatInput: value }),

  submitChat: () =>
    set((state) => {
      const content = state.chatInput.trim();
      if (!content) {
        return state;
      }

      return {
        chatInput: "",
        chatMessages: [
          ...state.chatMessages,
          {
            id: `user-${Date.now()}`,
            sender: "user",
            content,
            timestamp: formatTime(),
          },
          {
            id: `system-${Date.now()}`,
            sender: "system",
            content:
              "Operator message queued. Agent-driven tool assistance will be wired in a later pass.",
            timestamp: formatTime(),
          },
        ],
      };
    }),

  setManualCommandInput: (value) =>
    set({
      commandInput: value,
      commandSource: "manual" satisfies CommandSource,
    }),

  refreshGeneratedCommand: (value) =>
    set((state) => {
      if (state.commandSource === "manual") {
        return {
          generatedCommand: value,
        };
      }

      return {
        commandInput: value,
        generatedCommand: value,
      };
    }),

  syncGeneratedCommand: () => {
    const state = get();
    const toolModule = state.toolName
      ? toolRegistry[state.toolName]
      : undefined;
    const generatedCommand =
      toolModule?.buildGeneratedCommand(state.toolData) ?? "";

    get().refreshGeneratedCommand(generatedCommand);
  },

  resetCommandToGenerated: () => {
    set({
      commandInput: get().generatedCommand,
      commandSource: "generated",
    });
  },

  startExecution: (command) =>
    set((state) => {
      const toolRun =
        state.sessionId && state.toolName
          ? sessionRepository.recordToolRun(state.sessionId, {
              toolName: state.toolName,
              command,
              commandSource: state.commandSource,
              status: "running",
            })
          : null;

      return {
        outputLines: [`$ ${command}`, ""],
        executionStatus: "running" satisfies ExecutionStatus,
        lastExitCode: null,
        currentToolRunId: toolRun?.id ?? null,
      };
    }),

  appendOutput: (lines, stream = "stdout") =>
    set((state) => {
      if (state.currentToolRunId) {
        sessionRepository.appendToolRunLog(
          state.currentToolRunId,
          lines,
          stream,
        );
      }

      return {
        outputLines: [...state.outputLines, ...lines],
      };
    }),

  finishExecution: (status, exitCode) =>
    set((state) => {
      if (!state.currentToolRunId) {
        return state;
      }

      sessionRepository.finishToolRun(
        state.currentToolRunId,
        status,
        exitCode,
      );

      return {
        executionStatus: status,
        lastExitCode: exitCode,
        currentToolRunId: null,
      };
    }),

  cancelExecution: () =>
    set((state) => {
      if (state.executionStatus !== "running") {
        return state;
      }

      const cancelMessage = "[run cancelled by operator]";

      if (state.currentToolRunId) {
        sessionRepository.appendToolRunLog(
          state.currentToolRunId,
          ["", cancelMessage],
        );
        sessionRepository.cancelToolRun(state.currentToolRunId);
      }

      return {
        outputLines: [...state.outputLines, "", cancelMessage],
        executionStatus: "cancelled",
        lastExitCode: null,
        currentToolRunId: null,
      };
    }),

  runCommand: async () => {
    const state = get();
    const command = state.commandInput.trim();
    if (!command || state.executionStatus === "running") {
      return;
    }

    get().startExecution(command);

    try {
      const exitCode = await commandRunnerService.run(
        command,
        (lines) => {
          get().appendOutput(lines, "stdout");
        },
        (lines) => {
          get().appendOutput(lines, "stderr");
        },
      );

      if (get().executionStatus === "cancelled") {
        return;
      }

      get().finishExecution(exitCode === 0 ? "success" : "error", exitCode);
      get().appendOutput(["", `[process exited with code ${exitCode}]`]);
    } catch (error) {
      if (get().executionStatus === "cancelled") {
        return;
      }

      const message =
        error instanceof Error ? error.message : "Unknown execution error";
      get().appendOutput(["", `[execution failed] ${message}`]);
      get().finishExecution("error", null);
    }
  },

  stopCommand: () => {
    commandRunnerService.stop();
  },

  updateToolData: (updater) =>
    set((state) => ({
      toolData: updater(state.toolData),
    })),
}));
