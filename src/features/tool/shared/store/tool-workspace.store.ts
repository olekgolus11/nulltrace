import { create } from "zustand";
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

const initialOutputLines = [
  "Awaiting command.",
  "Use the form to build an operation or edit the full command manually.",
];
const clearedRunConfirmationState = {
  pendingRunConfirmation: null,
  confirmedRunCommand: null,
} as const;

const initialWorkspaceState: ToolWorkspaceStoreState = {
  toolName: null,
  sessionId: null,
  targetUrl: "",
  activePanel: "form",
  isHelpOpen: false,
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
  pendingRunConfirmation: null,
};

interface ToolWorkspaceStore extends ToolWorkspaceStoreState {
  confirmedRunCommand: string | null;
  initializeWorkspace: (toolName: string, targetUrl: string, sessionId: string) => void;
  cyclePanel: (direction: PanelDirection) => void;
  setActivePanel: (panel: ToolPanel) => void;
  openHelp: () => void;
  closeHelp: () => void;
  toggleHelp: () => void;
  setManualCommandInput: (value: string) => void;
  refreshGeneratedCommand: (value: string) => void;
  syncGeneratedCommand: () => void;
  resetCommandToGenerated: () => void;
  appendOutput: (lines: string[]) => void;
  runCommand: () => Promise<void>;
  confirmPendingRun: () => Promise<void>;
  cancelPendingRun: () => void;
  stopCommand: () => void;
  loadHistoryRuns: () => void;
  selectHistoryRun: (toolRunId: string) => void;
  moveHistorySelection: (direction: number) => void;
  exitHistoricPreview: () => void;
  rerunSelectedHistoryRun: () => void;
  updateToolData: (updater: (current: unknown) => unknown) => void;
  applyActionDraftState: (state: {
    toolData: unknown;
    commandInput: string;
    generatedCommand: string;
    commandSource: CommandSource;
    message: string;
  }) => boolean;
  reportActionDraftApplyError: (message: string) => void;
}

export const useToolWorkspaceStore = create<ToolWorkspaceStore>((set, get) => ({
  ...initialWorkspaceState,
  confirmedRunCommand: null,

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
      ...clearedRunConfirmationState,
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

  setManualCommandInput: (value) =>
    set((state) => ({
      commandInput: value,
      commandSource:
        value === state.generatedCommand
          ? ("generated" satisfies CommandSource)
          : ("manual" satisfies CommandSource),
      isHistoricPreview: false,
      ...clearedRunConfirmationState,
    })),

  refreshGeneratedCommand: (value) =>
    set((state) => {
      if (state.commandSource === "manual") {
        return {
          generatedCommand: value,
          ...clearedRunConfirmationState,
        };
      }

      return {
        commandInput: value,
        generatedCommand: value,
        ...clearedRunConfirmationState,
      };
    }),

  syncGeneratedCommand: () => {
    const state = get();
    const toolModule = state.toolName ? toolRegistry[state.toolName] : undefined;
    const generatedCommand = toolModule?.buildGeneratedCommand(state.toolData) ?? "";

    get().refreshGeneratedCommand(generatedCommand);
  },

  resetCommandToGenerated: () => {
    if (get().isHistoricPreview) {
      return;
    }

    set({
      commandInput: get().generatedCommand,
      commandSource: "generated",
      ...clearedRunConfirmationState,
    });
  },

  appendOutput: (lines) =>
    set((state) => ({
      outputLines: [...state.outputLines, ...lines],
    })),

  runCommand: async () => {
    const state = get();
    const command = state.commandInput.trim();
    if (!command || state.executionStatus === "running" || state.isHistoricPreview) {
      return;
    }

    const toolModule = state.toolName ? toolRegistry[state.toolName] : undefined;
    const isConfirmed = state.confirmedRunCommand === command;
    if (!isConfirmed) {
      const confirmation = toolModule?.getRunConfirmation?.(command, state.toolData);
      if (confirmation) {
        set({
          pendingRunConfirmation: {
            ...confirmation,
            command,
          },
        });
        return;
      }
    }
    set(clearedRunConfirmationState);
    const persistedCommand = toolModule?.redactCommandForPersistence?.(command) ?? command;
    const runToolData = state.toolData;
    const resetToolData = toolModule?.resetRunScopedState?.(runToolData);

    set({
      outputLines: [`$ ${persistedCommand}`, ""],
      executionStatus: "running" satisfies ExecutionStatus,
      lastExitCode: null,
      currentToolRunId: null,
      isHistoricPreview: false,
      ...(resetToolData === undefined ? {} : { toolData: resetToolData }),
    });

    await toolRunnerService.run({
      sessionId: state.sessionId,
      toolName: state.toolName,
      command,
      commandSource: state.commandSource,
      toolModule,
      targetUrl: state.targetUrl,
      toolData: runToolData,
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

  confirmPendingRun: async () => {
    const state = get();
    const pending = state.pendingRunConfirmation;
    if (!pending || pending.command !== state.commandInput.trim()) {
      set(clearedRunConfirmationState);
      return;
    }
    set({
      pendingRunConfirmation: null,
      confirmedRunCommand: pending.command,
    });
    await get().runCommand();
  },

  cancelPendingRun: () =>
    set(clearedRunConfirmationState),

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
      selectedHistoryRunId: historyRuns.some((run) => run.id === current.selectedHistoryRunId)
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
        state.historyRuns.findIndex((run) => run.id === state.selectedHistoryRunId),
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
      ...clearedRunConfirmationState,
    });
  },

  updateToolData: (updater) =>
    set((state) => ({
      toolData: updater(state.toolData),
      ...clearedRunConfirmationState,
    })),

  applyActionDraftState: (draftState) => {
    if (get().executionStatus === "running") {
      set({
        activePanel: "output",
        outputLines: [
          "Could not apply action draft.",
          "A scanner is currently running. Stop or wait for it to finish before applying a draft.",
          "The active scanner process was left running.",
        ],
      });
      return false;
    }

    set({
      toolData: draftState.toolData,
      commandInput: draftState.commandInput,
      generatedCommand: draftState.generatedCommand,
      commandSource: draftState.commandSource,
      activePanel: "form",
      outputLines: [draftState.message, "Review and edit the scanner workspace before running."],
      executionStatus: "idle",
      lastExitCode: null,
      currentToolRunId: null,
      selectedHistoryRun: null,
      isHistoricPreview: false,
      ...clearedRunConfirmationState,
    });
    return true;
  },

  reportActionDraftApplyError: (message) =>
    set({
      activePanel: "output",
      outputLines: [
        "Could not apply action draft.",
        message,
        "The draft may be stale or missing compatible scanner state.",
      ],
    }),
}));
