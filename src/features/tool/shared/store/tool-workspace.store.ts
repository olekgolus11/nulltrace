import { create } from "zustand";
import { ChatMessageData } from "../../../chat/model/chat.types";
import { sessionRepository } from "../../../session/services/session.repository";
import { toolRunnerService } from "../services/tool-runner.service";
import {
  CommandSource,
  ExecutionStatus,
  ToolPanel,
  ToolWorkspaceStoreState,
} from "../types/tool-screen.types";
import { toolPanels, toolRegistry } from "../registry/tool-registry";
import { cyclePanel as getCycledPanel } from "../../../../shared/model/panel-navigation";
import { PanelDirection } from "../../../../shared/model/panel-navigation.types";

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
  historyRuns: [],
  selectedHistoryRunId: null,
  selectedHistoryRun: null,
  isHistoricPreview: false,
  toolData: null,
};

function formatTime() {
  return new Date().toLocaleTimeString([], {
    hour: "2-digit",
    minute: "2-digit",
  });
}

interface ToolWorkspaceStore extends ToolWorkspaceStoreState {
  initializeWorkspace: (
    toolName: string,
    targetUrl: string,
    sessionId: string,
  ) => void;
  cyclePanel: (direction: PanelDirection) => void;
  setActivePanel: (panel: ToolPanel) => void;
  openHelp: () => void;
  closeHelp: () => void;
  toggleHelp: () => void;
  setChatInput: (value: string) => void;
  submitChat: (value?: string) => void;
  setManualCommandInput: (value: string) => void;
  refreshGeneratedCommand: (value: string) => void;
  syncGeneratedCommand: () => void;
  resetCommandToGenerated: () => void;
  appendOutput: (lines: string[]) => void;
  runCommand: () => Promise<void>;
  stopCommand: () => void;
  loadHistoryRuns: () => void;
  selectHistoryRun: (toolRunId: string) => void;
  moveHistorySelection: (direction: number) => void;
  exitHistoricPreview: () => void;
  rerunSelectedHistoryRun: () => void;
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
      historyRuns: [],
      selectedHistoryRunId: null,
      selectedHistoryRun: null,
      isHistoricPreview: false,
      toolData,
    });

    get().loadHistoryRuns();
  },

  cyclePanel: (direction) =>
    set((state) => ({
      activePanel: getCycledPanel(toolPanels, state.activePanel, direction),
    })),

  setActivePanel: (panel) => set({ activePanel: panel }),

  openHelp: () => set({ isHelpOpen: true }),

  closeHelp: () => set({ isHelpOpen: false }),

  toggleHelp: () => set((state) => ({ isHelpOpen: !state.isHelpOpen })),

  setChatInput: (value) => set({ chatInput: value }),

  submitChat: (value) =>
    set((state) => {
      const submittedValue = value?.trim() ? value : state.chatInput;
      const content = submittedValue.trim();
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
    set((state) => ({
      commandInput: value,
      commandSource:
        value === state.generatedCommand
          ? ("generated" satisfies CommandSource)
          : ("manual" satisfies CommandSource),
      isHistoricPreview: false,
    })),

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
    if (get().isHistoricPreview) {
      return;
    }

    set({
      commandInput: get().generatedCommand,
      commandSource: "generated",
    });
  },

  appendOutput: (lines) =>
    set((state) => ({
      outputLines: [...state.outputLines, ...lines],
    })),

  runCommand: async () => {
    const state = get();
    const command = state.commandInput.trim();
    if (
      !command ||
      state.executionStatus === "running" ||
      state.isHistoricPreview
    ) {
      return;
    }

    const toolModule = state.toolName
      ? toolRegistry[state.toolName]
      : undefined;

    set({
      outputLines: [`$ ${command}`, ""],
      executionStatus: "running" satisfies ExecutionStatus,
      lastExitCode: null,
      currentToolRunId: null,
      isHistoricPreview: false,
    });

    await toolRunnerService.run({
      sessionId: state.sessionId,
      toolName: state.toolName,
      command,
      commandSource: state.commandSource,
      toolModule,
      onRunStarted: (toolRunId) => {
        set({
          currentToolRunId: toolRunId,
        });
        get().loadHistoryRuns();
      },
      onStdoutLines: (lines) => {
        get().appendOutput(lines);
      },
      onStderrLines: (lines) => {
        get().appendOutput(lines);
      },
      onSystemLines: (lines) => {
        get().appendOutput(lines);
      },
      onRunFinished: ({ status, exitCode }) => {
        set({
          executionStatus: status,
          lastExitCode: exitCode,
          currentToolRunId: null,
        });
        get().loadHistoryRuns();
      },
      onRunCancelled: () => {
        set({
          executionStatus: "cancelled",
          lastExitCode: null,
          currentToolRunId: null,
        });
        get().loadHistoryRuns();
      },
    });
  },

  stopCommand: () => {
    toolRunnerService.stop();
  },

  loadHistoryRuns: () => {
    const state = get();
    const historyRuns =
      state.sessionId && state.toolName
        ? sessionRepository.listToolRuns(state.sessionId, state.toolName)
        : [];

    set((current) => ({
      historyRuns,
      selectedHistoryRunId: historyRuns.some(
        (run) => run.id === current.selectedHistoryRunId,
      )
        ? current.selectedHistoryRunId
        : (historyRuns[0]?.id ?? null),
    }));
  },

  selectHistoryRun: (toolRunId) => {
    const selectedHistoryRun = sessionRepository.getToolRunWithLogs(toolRunId);

    if (!selectedHistoryRun) {
      return;
    }

    set({
      selectedHistoryRunId: toolRunId,
      selectedHistoryRun,
      isHistoricPreview: true,
    });
  },

  moveHistorySelection: (direction) =>
    set((state) => {
      if (state.historyRuns.length === 0) {
        return state;
      }

      const currentIndex = Math.max(
        0,
        state.historyRuns.findIndex(
          (run) => run.id === state.selectedHistoryRunId,
        ),
      );
      const nextIndex = Math.min(
        state.historyRuns.length - 1,
        Math.max(0, currentIndex + direction),
      );
      const selectedHistoryRunId = state.historyRuns[nextIndex]?.id ?? null;

      return {
        selectedHistoryRunId,
      };
    }),

  exitHistoricPreview: () =>
    set({
      selectedHistoryRun: null,
      isHistoricPreview: false,
    }),

  rerunSelectedHistoryRun: () => {
    const state = get();
    const selectedHistoryRun =
      state.selectedHistoryRun ??
      (state.selectedHistoryRunId
        ? sessionRepository.getToolRunWithLogs(state.selectedHistoryRunId)
        : null);

    if (!selectedHistoryRun) {
      return;
    }

    set({
      commandInput: selectedHistoryRun.command,
      commandSource: "manual",
      activePanel: "command",
      outputLines: initialOutputLines,
      selectedHistoryRun: null,
      selectedHistoryRunId: selectedHistoryRun.id,
      isHistoricPreview: false,
    });
  },

  updateToolData: (updater) =>
    set((state) => ({
      toolData: updater(state.toolData),
    })),
}));
