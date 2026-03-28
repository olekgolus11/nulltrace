import { useKeyboard } from "@opentui/react";
import { useEffect, useReducer } from "react";
import {
  flattenSessionRows,
  getInitialExpandedTargetIds,
} from "../../session/model/session-list";
import {
  EntryPanel,
  EntryState,
  initialEntryState,
} from "../model/entry.state";
import { UseEntryShortcutsProps } from "../model/entry.types";

type EntryAction =
  | { type: "CYCLE_PANEL" }
  | { type: "MOVE_SELECTION"; delta: -1 | 1; rowCount: number }
  | { type: "SET_URL_INPUT"; value: string }
  | { type: "TOGGLE_TARGET"; targetId: string }
  | { type: "INITIALIZE_TARGETS"; expandedTargetIds: Record<string, boolean> }
  | { type: "CLAMP_SELECTION"; rowCount: number };

const PANELS: EntryPanel[] = ["input", "sessions"];

function clamp(value: number, min: number, max: number) {
  return Math.max(min, Math.min(max, value));
}

function getNextPanel(current: EntryPanel): EntryPanel {
  const currentIndex = PANELS.indexOf(current);
  return PANELS[(currentIndex + 1) % PANELS.length]!;
}

function createEntryReducer() {
  return function dashboardReducer(
    state: EntryState,
    action: EntryAction,
  ): EntryState {
    switch (action.type) {
      case "CYCLE_PANEL":
        return {
          ...state,
          activePanel: getNextPanel(state.activePanel),
        };

      case "MOVE_SELECTION":
        return {
          ...state,
          selectedRow: clamp(
            state.selectedRow + action.delta,
            0,
            Math.max(0, action.rowCount - 1),
          ),
        };

      case "SET_URL_INPUT":
        return {
          ...state,
          urlInput: action.value,
        };

      case "TOGGLE_TARGET":
        return {
          ...state,
          expandedTargetIds: {
            ...state.expandedTargetIds,
            [action.targetId]:
              state.expandedTargetIds[action.targetId] === false,
          },
        };

      case "INITIALIZE_TARGETS":
        return {
          ...state,
          expandedTargetIds:
            Object.keys(state.expandedTargetIds).length > 0
              ? state.expandedTargetIds
              : action.expandedTargetIds,
        };

      case "CLAMP_SELECTION":
        return {
          ...state,
          selectedRow: clamp(
            state.selectedRow,
            0,
            Math.max(0, action.rowCount - 1),
          ),
        };

      default:
        return state;
    }
  };
}

export function useEntryShortcuts({
  targets,
  onStartPentest,
  onOpenSession,
}: UseEntryShortcutsProps) {
  const initialExpandedTargetIds = getInitialExpandedTargetIds(targets);
  const reducer = createEntryReducer();
  const [state, dispatch] = useReducer(reducer, initialEntryState);
  const rows = flattenSessionRows(targets, state.expandedTargetIds);

  const setUrlInput = (value: string) => {
    dispatch({ type: "SET_URL_INPUT", value });
  };

  const submitUrlInput = (arg: unknown) => {
    const value = typeof arg === "string" ? arg : "";
    const nextValue = value.trim() ? value : state.urlInput;

    if (!nextValue.trim()) return;

    const url = nextValue.trim();
    if (!url) return;
    onStartPentest(url);
  };

  useEffect(() => {
    if (
      Object.keys(state.expandedTargetIds).length > 0 ||
      Object.keys(initialExpandedTargetIds).length === 0
    ) {
      return;
    }

    dispatch({
      type: "INITIALIZE_TARGETS",
      expandedTargetIds: initialExpandedTargetIds,
    });
  }, [initialExpandedTargetIds, state.expandedTargetIds]);

  useEffect(() => {
    dispatch({
      type: "CLAMP_SELECTION",
      rowCount: rows.length,
    });
  }, [rows.length]);

  const submitSelectedSession = () => {
    const row = rows[state.selectedRow];
    if (!row) return;

    if (row.type === "target") {
      dispatch({
        type: "TOGGLE_TARGET",
        targetId: row.targetId,
      });
      return;
    }

    onOpenSession(row.sessionId);
  };

  useKeyboard((key) => {
    if (key.name === "tab") {
      dispatch({ type: "CYCLE_PANEL" });
      return;
    }

    if (state.activePanel === "sessions") {
      if (key.name === "up") {
        dispatch({ type: "MOVE_SELECTION", delta: -1, rowCount: rows.length });
      }
      if (key.name === "down") {
        dispatch({ type: "MOVE_SELECTION", delta: 1, rowCount: rows.length });
      }
      if (key.name === "left" || key.name === "right") {
        const row = rows[state.selectedRow];
        if (row?.type === "target") {
          dispatch({
            type: "TOGGLE_TARGET",
            targetId: row.targetId,
          });
        }
      }
      if (key.name === "enter" || key.name === "return") {
        submitSelectedSession();
      }
      return;
    }
  });

  return {
    entryState: state,
    rows,
    setUrlInput,
    submitUrlInput,
  };
}
