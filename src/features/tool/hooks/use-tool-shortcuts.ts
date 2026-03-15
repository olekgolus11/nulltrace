import { useKeyboard } from "@opentui/react";
import { useCallback, useEffect, useMemo, useReducer, useRef } from "react";
import {
  buildNmapCommand,
  nmapFieldOrder,
  nmapTimingOptions,
} from "../data/tool-definitions";
import { createInitialToolState } from "../model/tool.state";
import {
  NmapFieldId,
  NmapFormState,
  NmapTiming,
  ToolPanel,
  ToolState,
} from "../model/tool.types";

type ToolAction =
  | { type: "CYCLE_PANEL" }
  | { type: "MOVE_FORM_SELECTION"; delta: -1 | 1 }
  | { type: "SET_CHAT_INPUT"; value: string }
  | { type: "SUBMIT_CHAT" }
  | {
      type: "SET_NMAP_FIELD";
      field: keyof NmapFormState;
      value: string | boolean | NmapTiming;
    }
  | { type: "TOGGLE_BOOLEAN_FIELD"; field: NmapFieldId }
  | { type: "CYCLE_TIMING"; delta: -1 | 1 }
  | { type: "SET_COMMAND_INPUT"; value: string }
  | { type: "SYNC_GENERATED_COMMAND"; value: string }
  | { type: "RESET_COMMAND_TO_GENERATED"; value: string }
  | { type: "START_EXECUTION"; command: string }
  | { type: "APPEND_OUTPUT"; lines: string[] }
  | {
      type: "FINISH_EXECUTION";
      status: ToolState["executionStatus"];
      exitCode: number | null;
    };

const PANELS: ToolPanel[] = ["chat", "form", "command", "output"];
const BOOLEAN_FIELDS: NmapFieldId[] = [
  "serviceDetection",
  "osDetection",
  "defaultScripts",
  "aggressive",
];

function clamp(value: number, min: number, max: number) {
  return Math.max(min, Math.min(max, value));
}

function getNextPanel(current: ToolPanel): ToolPanel {
  const currentIndex = PANELS.indexOf(current);
  return PANELS[(currentIndex + 1) % PANELS.length]!;
}

function formatTime() {
  return new Date().toLocaleTimeString([], {
    hour: "2-digit",
    minute: "2-digit",
  });
}

function createToolReducer(targetUrl: string) {
  return function toolReducer(state: ToolState, action: ToolAction): ToolState {
    switch (action.type) {
      case "CYCLE_PANEL":
        return {
          ...state,
          activePanel: getNextPanel(state.activePanel),
        };

      case "MOVE_FORM_SELECTION":
        return {
          ...state,
          selectedFormField: clamp(
            state.selectedFormField + action.delta,
            0,
            nmapFieldOrder.length - 1,
          ),
        };

      case "SET_CHAT_INPUT":
        return {
          ...state,
          chatInput: action.value,
        };

      case "SUBMIT_CHAT": {
        const content = state.chatInput.trim();
        if (!content) {
          return state;
        }

        return {
          ...state,
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
      }

      case "SET_NMAP_FIELD":
        return {
          ...state,
          nmapForm: {
            ...state.nmapForm,
            [action.field]: action.value,
          },
        };

      case "TOGGLE_BOOLEAN_FIELD": {
        if (!BOOLEAN_FIELDS.includes(action.field)) {
          return state;
        }

        return {
          ...state,
          nmapForm: {
            ...state.nmapForm,
            [action.field]: !state.nmapForm[action.field],
          },
        };
      }

      case "CYCLE_TIMING": {
        const currentIndex = nmapTimingOptions.indexOf(state.nmapForm.timing);
        const nextIndex =
          (currentIndex + action.delta + nmapTimingOptions.length) %
          nmapTimingOptions.length;

        return {
          ...state,
          nmapForm: {
            ...state.nmapForm,
            timing: nmapTimingOptions[nextIndex]!,
          },
        };
      }

      case "SET_COMMAND_INPUT":
        return {
          ...state,
          commandInput: action.value,
          commandSource: "manual",
        };

      case "SYNC_GENERATED_COMMAND":
        if (state.commandSource === "manual") {
          return state;
        }

        return {
          ...state,
          commandInput: action.value,
        };

      case "RESET_COMMAND_TO_GENERATED":
        return {
          ...state,
          commandInput: action.value,
          commandSource: "generated",
        };

      case "START_EXECUTION":
        return {
          ...state,
          outputLines: [`$ ${action.command}`, ""],
          executionStatus: "running",
          lastExitCode: null,
        };

      case "APPEND_OUTPUT":
        return {
          ...state,
          outputLines: [...state.outputLines, ...action.lines],
        };

      case "FINISH_EXECUTION":
        return {
          ...state,
          executionStatus: action.status,
          lastExitCode: action.exitCode,
        };

      default:
        return state;
    }
  };
}

async function readStream(
  stream: ReadableStream<Uint8Array> | null | undefined,
  onLines: (lines: string[]) => void,
) {
  if (!stream) {
    return;
  }

  const reader = stream.getReader();
  const decoder = new TextDecoder();
  let buffer = "";

  while (true) {
    const { done, value } = await reader.read();
    if (done) {
      break;
    }

    buffer += decoder.decode(value, { stream: true }).replace(/\r/g, "");
    const parts = buffer.split("\n");
    buffer = parts.pop() ?? "";

    if (parts.length > 0) {
      onLines(parts);
    }
  }

  const trailing = (buffer + decoder.decode()).replace(/\r/g, "").trimEnd();
  if (trailing) {
    onLines([trailing]);
  }
}

export function useToolShortcuts({
  toolId,
  targetUrl,
  onBack,
}: {
  toolId: string;
  targetUrl: string;
  onBack: () => void;
}) {
  const reducer = useMemo(() => createToolReducer(targetUrl), [targetUrl]);
  const [state, dispatch] = useReducer(
    reducer,
    targetUrl,
    createInitialToolState,
  );
  const processRef = useRef<ReturnType<typeof Bun.spawn> | null>(null);

  const generatedCommand = useMemo(() => {
    if (toolId === "nmap") {
      return buildNmapCommand(state.nmapForm);
    }

    return "";
  }, [state.nmapForm, toolId]);

  useEffect(() => {
    dispatch({ type: "SYNC_GENERATED_COMMAND", value: generatedCommand });
  }, [generatedCommand]);

  useEffect(() => {
    return () => {
      processRef.current?.kill();
    };
  }, []);

  const setChatInput = useCallback((value: string) => {
    dispatch({ type: "SET_CHAT_INPUT", value });
  }, []);

  const submitChat = useCallback(() => {
    dispatch({ type: "SUBMIT_CHAT" });
  }, []);

  const setNmapField = useCallback(
    (field: keyof NmapFormState, value: string | boolean | NmapTiming) => {
      dispatch({ type: "SET_NMAP_FIELD", field, value });
    },
    [],
  );

  const setCommandInput = useCallback((value: string) => {
    dispatch({ type: "SET_COMMAND_INPUT", value });
  }, []);

  const runCommand = useCallback(async () => {
    const command = state.commandInput.trim();
    if (!command || state.executionStatus === "running") {
      return;
    }

    processRef.current?.kill();
    dispatch({ type: "START_EXECUTION", command });

    try {
      const proc = Bun.spawn({
        cmd: ["zsh", "-lc", command],
        stdout: "pipe",
        stderr: "pipe",
        stdin: "ignore",
      });
      processRef.current = proc;

      await Promise.all([
        readStream(proc.stdout, (lines) =>
          dispatch({ type: "APPEND_OUTPUT", lines }),
        ),
        readStream(proc.stderr, (lines) =>
          dispatch({ type: "APPEND_OUTPUT", lines }),
        ),
      ]);

      const exitCode = await proc.exited;
      dispatch({
        type: "FINISH_EXECUTION",
        status: exitCode === 0 ? "success" : "error",
        exitCode,
      });

      dispatch({
        type: "APPEND_OUTPUT",
        lines: [
          "",
          `[process exited with code ${exitCode}]`,
        ],
      });
    } catch (error) {
      const message =
        error instanceof Error ? error.message : "Unknown execution error";

      dispatch({
        type: "APPEND_OUTPUT",
        lines: ["", `[execution failed] ${message}`],
      });
      dispatch({
        type: "FINISH_EXECUTION",
        status: "error",
        exitCode: null,
      });
    } finally {
      processRef.current = null;
    }
  }, [state.commandInput, state.executionStatus]);

  useKeyboard((key) => {
    if (key.name === "escape") {
      onBack();
      return;
    }

    if (key.name === "tab") {
      dispatch({ type: "CYCLE_PANEL" });
      return;
    }

    if (key.ctrl && key.name === "r") {
      runCommand();
      return;
    }

    if (key.ctrl && key.name === "g") {
      dispatch({ type: "RESET_COMMAND_TO_GENERATED", value: generatedCommand });
      return;
    }

    if (state.activePanel === "form") {
      const selectedField = nmapFieldOrder[state.selectedFormField];

      if (key.name === "up") {
        dispatch({ type: "MOVE_FORM_SELECTION", delta: -1 });
        return;
      }

      if (key.name === "down") {
        dispatch({ type: "MOVE_FORM_SELECTION", delta: 1 });
        return;
      }

      if (selectedField === "timing") {
        if (key.name === "left") {
          dispatch({ type: "CYCLE_TIMING", delta: -1 });
          return;
        }
        if (key.name === "right") {
          dispatch({ type: "CYCLE_TIMING", delta: 1 });
          return;
        }
      }

      if (
        selectedField &&
        BOOLEAN_FIELDS.includes(selectedField) &&
        (key.name === "return" || key.name === "enter" || key.name === "space")
      ) {
        dispatch({ type: "TOGGLE_BOOLEAN_FIELD", field: selectedField });
      }
    }
  });

  return {
    toolState: state,
    generatedCommand,
    setChatInput,
    submitChat,
    setNmapField,
    setCommandInput,
    runCommand,
  };
}
