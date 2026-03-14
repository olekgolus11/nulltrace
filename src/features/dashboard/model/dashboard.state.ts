export type DashboardPanel = "sitemap" | "vulns" | "chat" | "tools";

export interface DashboardState {
  activePanel: DashboardPanel;
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
