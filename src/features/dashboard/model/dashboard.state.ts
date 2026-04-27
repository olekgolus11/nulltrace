import { PanelDefinition } from "../../../shared/model/panel-navigation.types";

export type DashboardPanelId = "sitemap" | "vulns" | "chat" | "tools";

export const dashboardPanels: Array<PanelDefinition<DashboardPanelId>> = [
  { id: "sitemap", label: "SITEMAP" },
  { id: "vulns", label: "VULNS" },
  { id: "chat", label: "CHAT" },
  { id: "tools", label: "TOOLS" },
];

export interface DashboardState {
  activePanel: DashboardPanelId;
  selectedTool: number;
  selectedSitemapItem: number;
  selectedVulnItem: number;
  chatInput: string;
}

export const initialDashboardState: DashboardState = {
  activePanel: "chat",
  selectedTool: 0,
  selectedSitemapItem: 0,
  selectedVulnItem: 0,
  chatInput: "",
};
