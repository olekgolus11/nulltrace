import { useKeyboard } from "@opentui/react";
import { useReducer } from "react";
import {
  EntryPanel,
  EntryState,
  initialEntryState,
} from "../model/entry.state";
import { UseEntryShortcutsProps } from "../model/entry.types";

type EntryAction =
  | { type: "CYCLE_PANEL" }
  | { type: "MOVE_SESSION_SELECTION"; delta: -1 | 1 }
  | { type: "SET_URL_INPUT"; value: string };

const PANELS: EntryPanel[] = ["input", "sessions"];

function clamp(value: number, min: number, max: number) {
  return Math.max(min, Math.min(max, value));
}

function getNextPanel(current: EntryPanel): EntryPanel {
  const currentIndex = PANELS.indexOf(current);
  return PANELS[(currentIndex + 1) % PANELS.length]!;
}

function createEntryReducer(counts: { sessionCount: number }) {
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

      case "MOVE_SESSION_SELECTION":
        return {
          ...state,
          selectedSession: clamp(
            state.selectedSession + action.delta,
            0,
            Math.max(0, counts.sessionCount - 1),
          ),
        };

      case "SET_URL_INPUT":
        return {
          ...state,
          urlInput: action.value,
        };

      default:
        return state;
    }
  };
}

export function useEntryShortcuts({
  sessions,
  onStartPentest,
}: UseEntryShortcutsProps) {
  const reducer = createEntryReducer({
    sessionCount: sessions.length,
  });

  const [state, dispatch] = useReducer(reducer, initialEntryState);

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

  const submitSelectedSession = () => {
    const session = sessions[state.selectedSession];
    if (!session) return;
    onStartPentest(session.url);
  };

  useKeyboard((key) => {
    if (key.name === "tab") {
      dispatch({ type: "CYCLE_PANEL" });
      return;
    }

    if (state.activePanel === "sessions") {
      if (key.name === "up") {
        dispatch({ type: "MOVE_SESSION_SELECTION", delta: -1 });
      }
      if (key.name === "down") {
        dispatch({ type: "MOVE_SESSION_SELECTION", delta: 1 });
      }
      if (key.name === "enter" || key.name === "return") {
        submitSelectedSession();
      }
      return;
    }

    // if (key.name === "enter" || key.name === "return") {
    //   submitUrlInput();
    // }
  });

  return {
    entryState: state,
    setUrlInput,
    submitUrlInput,
  };
}
