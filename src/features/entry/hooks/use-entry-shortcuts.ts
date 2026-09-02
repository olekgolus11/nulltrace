import { useKeyboard } from "@opentui/react";
import { useEffect, useReducer } from "react";
import {
  buildSessionSidebarRows,
  getInitialExpandedTargetId,
} from "../../session/model/session-list";
import { useSessionContextStore } from "../../session/store/session-context.store";
import { entryPanels, initialEntryState } from "../model/entry.state";
import { EntryPanel, EntryState } from "../model/entry.types";
import { cyclePanel } from "../../../shared/model/panel-navigation";
import { TargetSummary } from "../../session/model/session.types";

type EntryAction =
  | { type: "CYCLE_PANEL"; direction: -1 | 1 }
  | { type: "SET_ACTIVE_PANEL"; panel: EntryPanel }
  | { type: "MOVE_SELECTION"; delta: -1 | 1; rowCount: number }
  | { type: "SELECT_ROW"; index: number }
  | { type: "SET_URL_INPUT"; value: string }
  | { type: "TOGGLE_TARGET"; targetId: string }
  | { type: "INITIALIZE_TARGET"; targetId: string | null }
  | { type: "CLAMP_SELECTION"; rowCount: number };

interface UseEntryShortcutsProps {
  targets: TargetSummary[];
  onStartPentestForNewTarget: (targetUrl: string) => void;
  onOpenSession: (sessionId: string) => void;
  onStartPentestForExistingTarget: (target: TargetSummary) => void;
}

function clamp(value: number, min: number, max: number) {
  return Math.max(min, Math.min(max, value));
}

function createEntryReducer() {
  return function dashboardReducer(state: EntryState, action: EntryAction): EntryState {
    switch (action.type) {
      case "CYCLE_PANEL":
        return {
          ...state,
          activePanel: cyclePanel(entryPanels, state.activePanel, action.direction),
        };

      case "SET_ACTIVE_PANEL":
        return {
          ...state,
          activePanel: action.panel,
        };

    case "MOVE_SELECTION":
      return {
        ...state,
        selectedRow: clamp(state.selectedRow + action.delta, 0, Math.max(0, action.rowCount - 1)),
      };

    case "SELECT_ROW":
      return {
        ...state,
        activePanel: "sessions",
        selectedRow: action.index,
      };

      case "SELECT_ROW":
        return {
          ...state,
          activePanel: "sessions",
          selectedRow: action.index,
        };

      case "SET_URL_INPUT":
        return {
          ...state,
          urlInput: action.value,
        };

      case "TOGGLE_TARGET":
        return {
          ...state,
          expandedTargetId: state.expandedTargetId === action.targetId ? null : action.targetId,
        };

      case "INITIALIZE_TARGET":
        return {
          ...state,
          expandedTargetId: action.targetId,
        };

      case "CLAMP_SELECTION":
        return {
          ...state,
          selectedRow: clamp(state.selectedRow, 0, Math.max(0, action.rowCount - 1)),
        };
    }
  };
}

export function useEntryShortcuts({
  targets,
  onStartPentestForNewTarget,
  onStartPentestForExistingTarget,
  onOpenSession,
}: UseEntryShortcutsProps) {
  const currentSessionId = useSessionContextStore((state) => state.sessionId);
  const initialExpandedTargetId = getInitialExpandedTargetId(targets);
  const reducer = createEntryReducer();
  const [state, dispatch] = useReducer(reducer, initialEntryState);
  const expandedTargetId = state.expandedTargetId;
  const rows = buildSessionSidebarRows(targets, expandedTargetId, currentSessionId);

  const setUrlInput = (value: string) => {
    dispatch({ type: "SET_URL_INPUT", value });
  };

  const submitUrlInput = (arg: unknown) => {
    const value = typeof arg === "string" ? arg : "";
    const nextValue = value.trim() ? value : state.urlInput;

    if (!nextValue.trim()) return;

    const url = nextValue.trim();
    if (!url) return;
    onStartPentestForNewTarget(url);
  };

  useEffect(() => {
    if (initialExpandedTargetId === null) {
      return;
    }

    dispatch({
      type: "INITIALIZE_TARGET",
      targetId: initialExpandedTargetId,
    });
  }, [initialExpandedTargetId]);

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
        targetId: row.target.id,
      });
      return;
    }

    onOpenSession(row.session.id);
  };

  const createSessionFromSelectedTarget = () => {
    const row = rows[state.selectedRow];
    if (!row) return;

    const target = row.target;
    onStartPentestForExistingTarget(target);
  };

  useKeyboard((key) => {
    if (key.name === "tab") {
      dispatch({
        type: "CYCLE_PANEL",
        direction: key.shift ? -1 : 1,
      });
      return;
    }

    if (state.activePanel === "sessions") {
      if (key.ctrl && key.name === "n") {
        createSessionFromSelectedTarget();
        return;
      }
      if (key.name === "up") {
        dispatch({ type: "MOVE_SELECTION", delta: -1, rowCount: rows.length });
      }
      if (key.name === "down") {
        dispatch({ type: "MOVE_SELECTION", delta: 1, rowCount: rows.length });
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
    setActivePanel: (panel: EntryPanel) => dispatch({ type: "SET_ACTIVE_PANEL", panel }),
    selectRow: (index: number) => dispatch({ type: "SELECT_ROW", index }),
  };
}
