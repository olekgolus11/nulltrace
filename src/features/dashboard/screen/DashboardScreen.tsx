import { useTerminalDimensions } from "@opentui/react";
import { theme } from "../../../app/theme/theme";
import {
  CenterDashboardPanel,
  LeftDashboardPanel,
  RightDashboardPanel,
} from "../components/DashboardPanels";
import { useDashboardLayout } from "../hooks/use-dashboard-layout";
import { useDashboardShortcuts } from "../hooks/use-dashboard-shortcuts";
import { dashboardPanels } from "../model/dashboard.state";
import { Header } from "../../../shared/ui/Header";
import { StatusBar } from "../../../shared/ui/StatusBar";
import { FindingDetailModal } from "../../finding/components/FindingDetailModal";
import { useSessionFindings } from "../../finding/hooks/use-session-findings";
import { useSessionContextStore } from "../../session/store/session-context.store";
import { ToolName } from "../../tool/shared/types/tool-screen.types";

interface DashboardScreenProps {
  onSelectTool: (toolName: ToolName) => void;
  onBack: () => void;
}

export function DashboardScreen({
  onSelectTool,
  onBack,
}: DashboardScreenProps) {
  const { width, height } = useTerminalDimensions();
  const sessionId = useSessionContextStore((state) => state.sessionId);
  const targetUrl = useSessionContextStore((state) => state.targetUrl);
  const activeConversationId = useSessionContextStore(
    (state) => state.activeConversationId,
  );
  const activeConversationTitle = useSessionContextStore(
    (state) => state.activeConversationTitle,
  );
  const conversationError = useSessionContextStore(
    (state) => state.conversationError,
  );
  const sessionFindings = useSessionFindings(sessionId);
  const layout = useDashboardLayout({
    width,
    height,
  });
  const {
    dashboardState,
    setChatInput,
    submitChat,
    setActivePanel,
    selectFinding,
    sitemapScrollRef,
    findingsScrollRef,
    findingDetailScrollRef,
  } = useDashboardShortcuts({
    onBack,
    onSelectTool,
    findings: sessionFindings.findings,
    onSetFindingReviewStatus: sessionFindings.setReviewStatus,
  });
  const selectedFindingDetail = dashboardState.selectedFindingDetailId
    ? sessionFindings.findings.find(
        (finding) => finding.id === dashboardState.selectedFindingDetailId,
      )
    : null;
  const modalWidth = Math.max(1, Math.min(96, width - 8));
  const modalHeight = Math.max(1, Math.min(30, height - 6));

  return (
    <box
      flexDirection="column"
      width={width}
      height={height}
      backgroundColor={theme.bg.primary}
    >
      <Header targetUrl={targetUrl} counts={sessionFindings.counts} />
      <box flexDirection="row" height={layout.contentHeight}>
        <LeftDashboardPanel
          layout={layout}
          dashboardState={dashboardState}
          findings={sessionFindings.findings}
          sitemapScrollRef={sitemapScrollRef}
          findingsScrollRef={findingsScrollRef}
          setActivePanel={setActivePanel}
          selectFinding={selectFinding}
        />
        <CenterDashboardPanel
          layout={layout}
          dashboardState={dashboardState}
          submitChat={submitChat}
          setChatInput={setChatInput}
          setActivePanel={setActivePanel}
          activeConversationId={activeConversationId}
          activeConversationTitle={activeConversationTitle}
          conversationError={conversationError}
        />
        <RightDashboardPanel
          layout={layout}
          dashboardState={dashboardState}
          setActivePanel={setActivePanel}
        />
      </box>
      <StatusBar
        activePanel={dashboardState.activePanel}
        panels={dashboardPanels}
        hints={[
          ...(selectedFindingDetail
            ? [
                { key: "Up/Down", label: "scroll" },
                { key: "ESC", label: "close" },
              ]
            : [
                { key: "Tab/Shift+Tab", label: "switch" },
                { key: "Ctrl+1-4", label: "jump" },
                { key: "Enter", label: "select" },
                { key: "ESC", label: "back" },
                { key: "Ctrl+Q", label: "quit" },
              ]),
        ]}
      />
      {selectedFindingDetail ? (
        <FindingDetailModal
          finding={selectedFindingDetail}
          width={modalWidth}
          height={modalHeight}
          scrollRef={findingDetailScrollRef}
        />
      ) : null}
    </box>
  );
}
