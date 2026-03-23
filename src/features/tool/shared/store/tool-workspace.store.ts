import { create } from "zustand";
import { ChatMessageData } from "../../../chat/model/chat.types";
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
  initializeWorkspace: (toolId: string, targetUrl: string) => void;
  cyclePanel: () => void;
  setActivePanel: (panel: ToolPanel) => void;
  setChatInput: (value: string) => void;
  submitChat: () => void;
  setCommandInput: (value: string) => void;
  setGeneratedCommand: (value: string) => void;
  syncGeneratedCommand: () => void;
  resetCommandToGenerated: () => void;
  startExecution: (command: string) => void;
  appendOutput: (lines: string[]) => void;
  finishExecution: (status: ExecutionStatus, exitCode: number | null) => void;
  runCommand: () => Promise<void>;
  stopCommand: () => void;
  updateToolData: (updater: (current: unknown) => unknown) => void;
}

export const useToolWorkspaceStore = create<ToolWorkspaceStore>((set, get) => ({
  toolId: null,
  targetUrl: "",
  activePanel: "form",
  chatInput: "",
  chatMessages: initialChatMessages,
  commandInput: "",
  commandSource: "generated",
  outputLines: initialOutputLines,
  executionStatus: "idle",
  lastExitCode: null,
  toolData: null,

  initializeWorkspace: (toolId, targetUrl) => {
    const toolModule = toolRegistry[toolId];
    const toolData = toolModule?.createInitialToolData(targetUrl) ?? null;
    const generatedCommand = toolModule?.buildGeneratedCommand(toolData) ?? "";

    set({
      toolId,
      targetUrl,
      activePanel: "form",
      chatInput: "",
      chatMessages: initialChatMessages,
      commandInput: generatedCommand,
      commandSource: "generated",
      outputLines: initialOutputLines,
      executionStatus: "idle",
      lastExitCode: null,
      toolData,
    });
  },

  cyclePanel: () =>
    set((state) => ({
      activePanel: getNextPanel(state.activePanel),
    })),

  setActivePanel: (panel) => set({ activePanel: panel }),

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

  setCommandInput: (value) =>
    set({
      commandInput: value,
      commandSource: "manual" satisfies CommandSource,
    }),

  setGeneratedCommand: (value) =>
    set((state) => {
      if (state.commandSource === "manual") {
        return state;
      }

      return { commandInput: value };
    }),

  syncGeneratedCommand: () => {
    const state = get();
    const toolModule = state.toolId ? toolRegistry[state.toolId] : undefined;
    const generatedCommand =
      toolModule?.buildGeneratedCommand(state.toolData) ?? "";

    get().setGeneratedCommand(generatedCommand);
  },

  resetCommandToGenerated: () => {
    const state = get();
    const toolModule = state.toolId ? toolRegistry[state.toolId] : undefined;
    const generatedCommand =
      toolModule?.buildGeneratedCommand(state.toolData) ?? "";

    set({
      commandInput: generatedCommand,
      commandSource: "generated",
    });
  },

  startExecution: (command) =>
    set({
      outputLines: [`$ ${command}`, ""],
      executionStatus: "running",
      lastExitCode: null,
    }),

  appendOutput: (lines) =>
    set((state) => ({
      outputLines: [...state.outputLines, ...lines],
    })),

  finishExecution: (status, exitCode) =>
    set({
      executionStatus: status,
      lastExitCode: exitCode,
    }),

  runCommand: async () => {
    const state = get();
    const command = state.commandInput.trim();
    if (!command || state.executionStatus === "running") {
      return;
    }

    get().startExecution(command);

    try {
      const exitCode = await commandRunnerService.run(command, (lines) => {
        get().appendOutput(lines);
      });

      get().finishExecution(exitCode === 0 ? "success" : "error", exitCode);
      get().appendOutput(["", `[process exited with code ${exitCode}]`]);
    } catch (error) {
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
