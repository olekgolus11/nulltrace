import { PanelDefinition } from "../../../shared/model/panel-navigation.types";
import { DashboardPanelId, DashboardState } from "./dashboard.types";

export const dashboardPanels: Array<PanelDefinition<DashboardPanelId>> = [
  { id: "sitemap", label: "SITEMAP" },
  { id: "vulns", label: "VULNS" },
  { id: "chat", label: "CHAT" },
  { id: "tools", label: "TOOLS" },
];

export const initialDashboardState: DashboardState = {
  activePanel: "chat",
  selectedTool: 0,
  selectedSitemapItem: 0,
  selectedVulnItem: 0,
  chatInput: "",
};
