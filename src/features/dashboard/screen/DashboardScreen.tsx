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
import { Header } from "../../../shared/ui/Header";
import { StatusBar } from "../../../shared/ui/StatusBar";

export function DashboardScreen({
  targetUrl,
  onSelectTool,
  onBack,
}: DashboardScreenProps) {
  const { width, height } = useTerminalDimensions();
  const layout = useDashboardLayout({
    width,
    height,
  });
  const { dashboardState, setChatInput, submitChat } = useDashboardShortcuts({
    targetUrl,
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
        <LeftDashboardPanel layout={layout} dashboardState={dashboardState} />
        <CenterDashboardPanel
          layout={layout}
          dashboardState={dashboardState}
          submitChat={submitChat}
          setChatInput={setChatInput}
        />
        <RightDashboardPanel layout={layout} dashboardState={dashboardState} />
      </box>
      <StatusBar activePanel={dashboardState.activePanel} />
    </box>
  );
}
