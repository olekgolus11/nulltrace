import { useTerminalDimensions } from "@opentui/react";
import { theme } from "../../../app/theme/theme";
import {
  CenterDashboardPanel,
  LeftDashboardPanel,
  RightDashboardPanel,
} from "../components/DashboardPanels";
import { useDashboardLayout } from "../hooks/use-dashboard-layout";
import { useDashboardShortcuts } from "../hooks/use-dashboard-shortcuts";
import { DashboardScreenProps } from "../model/dashboard.types";
import { dashboardPanels } from "../model/dashboard.state";
import { Header } from "../../../shared/ui/Header";
import { StatusBar } from "../../../shared/ui/StatusBar";
import { useSessionContextStore } from "../../session/store/session-context.store";

export function DashboardScreen({
  onSelectTool,
  onBack,
}: DashboardScreenProps) {
  const { width, height } = useTerminalDimensions();
  const targetUrl = useSessionContextStore((state) => state.targetUrl);
  const layout = useDashboardLayout({
    width,
    height,
  });
  const {
    dashboardState,
    setChatInput,
    submitChat,
    setActivePanel,
    sitemapScrollRef,
    vulnsScrollRef,
  } = useDashboardShortcuts({
    onBack,
    onSelectTool,
  });

  return (
    <box
      flexDirection="column"
      width={width}
      height={height}
      backgroundColor={theme.bg.primary}
    >
      <Header targetUrl={targetUrl} showControls={false} />
      <box flexDirection="row" height={layout.contentHeight}>
        <LeftDashboardPanel
          layout={layout}
          dashboardState={dashboardState}
          sitemapScrollRef={sitemapScrollRef}
          vulnsScrollRef={vulnsScrollRef}
          setActivePanel={setActivePanel}
        />
        <CenterDashboardPanel
          layout={layout}
          dashboardState={dashboardState}
          submitChat={submitChat}
          setChatInput={setChatInput}
          setActivePanel={setActivePanel}
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
          { key: "Tab/Shift+Tab", label: "switch" },
          { key: "Ctrl+1-4", label: "jump" },
          { key: "Enter", label: "select" },
          { key: "ESC", label: "back" },
          { key: "Ctrl+Q", label: "quit" },
        ]}
      />
    </box>
  );
}
