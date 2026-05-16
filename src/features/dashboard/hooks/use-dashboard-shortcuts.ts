import { ScrollBoxRenderable } from "@opentui/core";
import { useKeyboard } from "@opentui/react";
import { useRef, useReducer } from "react";
import {
  mockSitemapFlatNodes,
  mockVulnerabilities,
} from "../data/dashboard.mock";
import { tools } from "../data/tool-catalog";
import {
  dashboardPanels,
  initialDashboardState,
} from "../model/dashboard.state";
import { DashboardPanelId, DashboardState } from "../model/dashboard.types";
import {
  cyclePanel,
  getPanelByShortcut,
} from "../../../shared/model/panel-navigation";
import { ToolName } from "../../tool/shared/types/tool-screen.types";

type DashboardAction =
  | { type: "CYCLE_PANEL"; direction: -1 | 1 }
  | { type: "SET_ACTIVE_PANEL"; panel: DashboardPanelId }
  | { type: "MOVE_TOOL_SELECTION"; delta: -1 | 1 }
  | { type: "MOVE_SITEMAP_SELECTION"; delta: -1 | 1 }
  | { type: "MOVE_VULN_SELECTION"; delta: -1 | 1 }
  | { type: "SET_CHAT_INPUT"; value: string }
  | { type: "SUBMIT_CHAT" };

interface UseDashboardShortcutsProps {
  onBack: () => void;
  onSelectTool: (toolName: ToolName) => void;
}

function clamp(value: number, min: number, max: number) {
  return Math.max(min, Math.min(max, value));
}

function createDashboardReducer(counts: {
  toolCount: number;
  sitemapCount: number;
  vulnerabilityCount: number;
}) {
  return function dashboardReducer(
    state: DashboardState,
    action: DashboardAction,
  ): DashboardState {
    switch (action.type) {
      case "CYCLE_PANEL":
        return {
          ...state,
          activePanel: cyclePanel(
            dashboardPanels,
            state.activePanel,
            action.direction,
          ),
        };

      case "SET_ACTIVE_PANEL":
        return {
          ...state,
          activePanel: action.panel,
        };

      case "MOVE_TOOL_SELECTION":
        return {
          ...state,
          selectedTool: clamp(
            state.selectedTool + action.delta,
            0,
            Math.max(0, counts.toolCount - 1),
          ),
        };

      case "MOVE_SITEMAP_SELECTION":
        return {
          ...state,
          selectedSitemapItem: clamp(
            state.selectedSitemapItem + action.delta,
            0,
            Math.max(0, counts.sitemapCount - 1),
          ),
        };

      case "MOVE_VULN_SELECTION":
        return {
          ...state,
          selectedVulnItem: clamp(
            state.selectedVulnItem + action.delta,
            0,
            Math.max(0, counts.vulnerabilityCount - 1),
          ),
        };

      case "SET_CHAT_INPUT":
        return {
          ...state,
          chatInput: action.value,
        };

      case "SUBMIT_CHAT":
        return {
          ...state,
          chatInput: "",
        };
    }
  };
}

export function useDashboardShortcuts({
  onBack,
  onSelectTool,
}: UseDashboardShortcutsProps) {
  const sitemapScrollRef = useRef<ScrollBoxRenderable | null>(null);
  const vulnsScrollRef = useRef<ScrollBoxRenderable | null>(null);
  const reducer = createDashboardReducer({
    toolCount: tools.length,
    sitemapCount: mockSitemapFlatNodes.length,
    vulnerabilityCount: mockVulnerabilities.length,
  });

  const [state, dispatch] = useReducer(reducer, initialDashboardState);

  useKeyboard((key) => {
    // Back to entry screen
    if (key.name === "escape") {
      onBack();
      return;
    }

    if (key.name === "tab") {
      dispatch({
        type: "CYCLE_PANEL",
        direction: key.shift ? -1 : 1,
      });
      return;
    }

    const shortcutPanel = getPanelByShortcut(
      dashboardPanels,
      key.name,
      key.ctrl,
    );
    if (shortcutPanel) {
      dispatch({ type: "SET_ACTIVE_PANEL", panel: shortcutPanel });
      return;
    }

    // Handle navigation based on active panel
    switch (state.activePanel) {
      case "tools":
        if (key.name === "up") {
          dispatch({
            type: "MOVE_TOOL_SELECTION",
            delta: -1,
          });
        }
        if (key.name === "down") {
          dispatch({
            type: "MOVE_TOOL_SELECTION",
            delta: 1,
          });
        }
        if (key.name === "return") {
          const tool = tools[state.selectedTool];
          if (tool) {
            onSelectTool(tool.id);
          }
        }
        break;

      case "sitemap":
        if (key.name === "up") {
          sitemapScrollRef.current?.scrollBy(-1, "step");
          dispatch({
            type: "MOVE_SITEMAP_SELECTION",
            delta: -1,
          });
        }
        if (key.name === "down") {
          sitemapScrollRef.current?.scrollBy(1, "step");
          dispatch({
            type: "MOVE_SITEMAP_SELECTION",
            delta: 1,
          });
        }
        break;

      case "vulns":
        if (key.name === "up") {
          vulnsScrollRef.current?.scrollBy(-1, "step");
          dispatch({
            type: "MOVE_VULN_SELECTION",
            delta: -1,
          });
        }
        if (key.name === "down") {
          vulnsScrollRef.current?.scrollBy(1, "step");
          dispatch({
            type: "MOVE_VULN_SELECTION",
            delta: 1,
          });
        }
        break;
    }
  });

  const setChatInput = (value: string) => {
    dispatch({ type: "SET_CHAT_INPUT", value });
  };

  const submitChat = () => {
    if (!state.chatInput.trim()) return;
    dispatch({ type: "SUBMIT_CHAT" });
  };

  const setActivePanel = (panel: DashboardPanelId) => {
    dispatch({ type: "SET_ACTIVE_PANEL", panel });
  };

  return {
    dashboardState: state,
    setChatInput,
    submitChat,
    setActivePanel,
    sitemapScrollRef,
    vulnsScrollRef,
  };
}
