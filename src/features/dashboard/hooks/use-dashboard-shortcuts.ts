import { ScrollBoxRenderable } from "@opentui/core";
import { useKeyboard } from "@opentui/react";
import { useEffect, useRef, useReducer } from "react";
import { tools } from "../data/tool-catalog";
import { dashboardPanels, initialDashboardState } from "../model/dashboard.state";
import { DashboardPanelId, DashboardState } from "../model/dashboard.types";
import { cyclePanel, getPanelByShortcut } from "../../../shared/model/panel-navigation";
import { FindingReviewStatus, SessionFindingRecord } from "../../finding/model/finding.types";
import { ToolName } from "../../tool/shared/types/tool-screen.types";
import { ActiveSessionConversation } from "../../chat/services/session-conversation.service";

type DashboardAction =
  | { type: "CYCLE_PANEL"; direction: -1 | 1 }
  | { type: "SET_ACTIVE_PANEL"; panel: DashboardPanelId }
  | { type: "MOVE_TOOL_SELECTION"; delta: -1 | 1 }
  | { type: "MOVE_SITEMAP_SELECTION"; delta: -1 | 1 }
  | { type: "SELECT_SITEMAP_ENTRY"; index: number }
  | { type: "MOVE_FINDING_SELECTION"; delta: -1 | 1 }
  | { type: "SELECT_FINDING"; index: number }
  | { type: "OPEN_FINDING_DETAIL"; findingId: string }
  | { type: "CLOSE_FINDING_DETAIL" }
  | { type: "OPEN_AUTHENTICATION_CONTEXT" }
  | { type: "CLOSE_AUTHENTICATION_CONTEXT" }
  | { type: "OPEN_PAGE_INSPECTION" }
  | { type: "CLOSE_PAGE_INSPECTION" }
  | { type: "OPEN_REPORT_EXPORT" }
  | { type: "CLOSE_REPORT_EXPORT" };

interface UseDashboardShortcutsProps {
  onBack: () => void;
  onSelectTool: (toolName: ToolName) => void;
  sitemapCount: number;
  onCycleSitemapDepth: (direction: -1 | 1) => void;
  onCycleSitemapProvenance: (direction: -1 | 1) => void;
  onPauseOrResumeSitemapCrawl: () => void;
  onRestartSitemapCrawl: () => void;
  isSitemapAuthRenewalRequired: boolean;
  findings: SessionFindingRecord[];
  onSetFindingReviewStatus: (findingId: string, reviewStatus: FindingReviewStatus) => void;
  conversations: ActiveSessionConversation[];
  activeConversationId: string | null;
  isConversationNavigationDisabled: boolean;
  onSelectConversation: (conversationId: string) => void;
  onCreateConversation: () => void;
  onArchiveActiveConversation: () => void;
}

function clamp(value: number, min: number, max: number) {
  return Math.max(min, Math.min(max, value));
}

const reviewStatusByShortcut: Record<string, FindingReviewStatus> = {
  "1": "needs_review",
  "2": "confirmed",
  "3": "dismissed",
};

function createDashboardReducer(counts: {
  toolCount: number;
  sitemapCount: number;
  findingCount: number;
}) {
  return function dashboardReducer(state: DashboardState, action: DashboardAction): DashboardState {
    switch (action.type) {
      case "CYCLE_PANEL":
        return {
          ...state,
          activePanel: cyclePanel(dashboardPanels, state.activePanel, action.direction),
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

      case "SELECT_SITEMAP_ENTRY":
        return {
          ...state,
          activePanel: "sitemap",
          selectedSitemapItem: clamp(action.index, 0, Math.max(0, counts.sitemapCount - 1)),
        };

      case "MOVE_FINDING_SELECTION":
        return {
          ...state,
          selectedFindingItem: clamp(
            state.selectedFindingItem + action.delta,
            0,
            Math.max(0, counts.findingCount - 1),
          ),
        };

      case "SELECT_FINDING":
        return {
          ...state,
          activePanel: "findings",
          selectedFindingItem: clamp(action.index, 0, Math.max(0, counts.findingCount - 1)),
        };

      case "OPEN_FINDING_DETAIL":
        return {
          ...state,
          selectedFindingDetailId: action.findingId,
        };

      case "CLOSE_FINDING_DETAIL":
        return {
          ...state,
          selectedFindingDetailId: null,
        };

      case "OPEN_AUTHENTICATION_CONTEXT":
        return {
          ...state,
          isAuthenticationContextOpen: true,
        };

      case "CLOSE_AUTHENTICATION_CONTEXT":
        return {
          ...state,
          isAuthenticationContextOpen: false,
        };

      case "OPEN_PAGE_INSPECTION":
        return {
          ...state,
          isPageInspectionOpen: true,
        };

      case "CLOSE_PAGE_INSPECTION":
        return {
          ...state,
          isPageInspectionOpen: false,
        };

      case "OPEN_REPORT_EXPORT":
        return {
          ...state,
          isReportExportOpen: true,
        };

      case "CLOSE_REPORT_EXPORT":
        return {
          ...state,
          isReportExportOpen: false,
        };
    }
  };
}

export function useDashboardShortcuts({
  onBack,
  onSelectTool,
  sitemapCount,
  onCycleSitemapDepth,
  onCycleSitemapProvenance,
  onPauseOrResumeSitemapCrawl,
  onRestartSitemapCrawl,
  isSitemapAuthRenewalRequired,
  findings,
  onSetFindingReviewStatus,
  conversations,
  activeConversationId,
  isConversationNavigationDisabled,
  onSelectConversation,
  onCreateConversation,
  onArchiveActiveConversation,
}: UseDashboardShortcutsProps) {
  const sitemapScrollRef = useRef<ScrollBoxRenderable | null>(null);
  const findingsScrollRef = useRef<ScrollBoxRenderable | null>(null);
  const findingDetailScrollRef = useRef<ScrollBoxRenderable | null>(null);
  const reducer = createDashboardReducer({
    toolCount: tools.length,
    sitemapCount,
    findingCount: findings.length,
  });

  const [state, dispatch] = useReducer(reducer, initialDashboardState);

  useEffect(() => {
    if (!state.selectedFindingDetailId) {
      return;
    }

    if (findings.some((finding) => finding.id === state.selectedFindingDetailId)) {
      return;
    }

    dispatch({ type: "CLOSE_FINDING_DETAIL" });
  }, [findings, state.selectedFindingDetailId]);

  useKeyboard((key) => {
    if (
      state.isAuthenticationContextOpen ||
      state.isPageInspectionOpen ||
      state.isReportExportOpen
    ) {
      if (key.name === "escape") {
        dispatch({
          type: state.isAuthenticationContextOpen
            ? "CLOSE_AUTHENTICATION_CONTEXT"
            : state.isPageInspectionOpen
              ? "CLOSE_PAGE_INSPECTION"
              : "CLOSE_REPORT_EXPORT",
        });
      }
      return;
    }

    if (state.selectedFindingDetailId) {
      const reviewStatus = reviewStatusByShortcut[key.name];

      if (reviewStatus) {
        onSetFindingReviewStatus(state.selectedFindingDetailId, reviewStatus);
        return;
      }
      if (key.name === "escape") {
        dispatch({ type: "CLOSE_FINDING_DETAIL" });
      }
      if (key.name === "up") {
        findingDetailScrollRef.current?.scrollBy(-1, "step");
      }
      if (key.name === "down") {
        findingDetailScrollRef.current?.scrollBy(1, "step");
      }
      return;
    }

    if (key.ctrl && key.name === "a") {
      dispatch({ type: "OPEN_AUTHENTICATION_CONTEXT" });
      return;
    }

    if (key.ctrl && key.name === "p") {
      dispatch({ type: "OPEN_PAGE_INSPECTION" });
      return;
    }

    if (key.ctrl && key.name === "e") {
      dispatch({ type: "OPEN_REPORT_EXPORT" });
      return;
    }

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

    const shortcutPanel = getPanelByShortcut(dashboardPanels, key.name, key.ctrl);
    if (shortcutPanel) {
      dispatch({ type: "SET_ACTIVE_PANEL", panel: shortcutPanel });
      return;
    }

    if (state.activePanel === "chat" && key.ctrl && !isConversationNavigationDisabled) {
      if (key.name === "n") {
        onCreateConversation();
        return;
      }

      if (key.name === "d" && activeConversationId) {
        onArchiveActiveConversation();
        return;
      }

      if (key.name === "left" || key.name === "right") {
        const activeIndex = conversations.findIndex(
          (conversation) => conversation.attachment.opencodeConversationId === activeConversationId,
        );
        const nextIndex = clamp(
          activeIndex + (key.name === "left" ? -1 : 1),
          0,
          Math.max(0, conversations.length - 1),
        );
        const nextConversation = conversations[nextIndex];
        if (nextConversation && nextIndex !== activeIndex) {
          onSelectConversation(nextConversation.attachment.opencodeConversationId);
        }
        return;
      }
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
        if (
          isSitemapAuthRenewalRequired &&
          (key.name === "space" || (key.ctrl && key.name === "r"))
        ) {
          dispatch({ type: "OPEN_AUTHENTICATION_CONTEXT" });
          return;
        }
        if (key.name === "space") {
          onPauseOrResumeSitemapCrawl();
          return;
        }
        if (key.ctrl && key.name === "r") {
          onRestartSitemapCrawl();
          return;
        }
        if (key.name === "p") {
          onCycleSitemapProvenance(key.shift ? -1 : 1);
          sitemapScrollRef.current?.scrollTo(0);
          return;
        }
        if (key.name === "left" || key.name === "right") {
          onCycleSitemapDepth(key.name === "left" ? -1 : 1);
          sitemapScrollRef.current?.scrollTo(0);
          return;
        }
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

      case "findings":
        if (key.name === "up") {
          findingsScrollRef.current?.scrollBy(-1, "step");
          dispatch({
            type: "MOVE_FINDING_SELECTION",
            delta: -1,
          });
        }
        if (key.name === "down") {
          findingsScrollRef.current?.scrollBy(1, "step");
          dispatch({
            type: "MOVE_FINDING_SELECTION",
            delta: 1,
          });
        }
        if (key.name === "return") {
          const finding = findings[state.selectedFindingItem];
          if (finding) {
            dispatch({
              type: "OPEN_FINDING_DETAIL",
              findingId: finding.id,
            });
          }
        }
        break;
    }
  });

  const setActivePanel = (panel: DashboardPanelId) => {
    dispatch({ type: "SET_ACTIVE_PANEL", panel });
  };

  const selectFinding = (index: number) => {
    const finding = findings[index];
    if (!finding) {
      return;
    }

    if (state.activePanel === "findings" && state.selectedFindingItem === index) {
      dispatch({
        type: "OPEN_FINDING_DETAIL",
        findingId: finding.id,
      });
      return;
    }

    dispatch({ type: "SELECT_FINDING", index });
  };

  const selectSitemapEntry = (index: number) => {
    if (index < 0 || index >= sitemapCount) {
      return;
    }

    dispatch({ type: "SELECT_SITEMAP_ENTRY", index });
  };

  const closeAuthenticationContext = () => {
    dispatch({ type: "CLOSE_AUTHENTICATION_CONTEXT" });
  };

  const closePageInspection = () => {
    dispatch({ type: "CLOSE_PAGE_INSPECTION" });
  };

  const closeReportExport = () => {
    dispatch({ type: "CLOSE_REPORT_EXPORT" });
  };

  return {
    dashboardState: state,
    setActivePanel,
    selectSitemapEntry,
    selectFinding,
    closeAuthenticationContext,
    closePageInspection,
    closeReportExport,
    sitemapScrollRef,
    findingsScrollRef,
    findingDetailScrollRef,
  };
}
