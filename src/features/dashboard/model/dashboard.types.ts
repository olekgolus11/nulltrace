import { ToolName } from "../../tool/shared/types/tool-screen.types";

export type DashboardPanelId = "sitemap" | "vulns" | "chat" | "tools";

export interface DashboardState {
  activePanel: DashboardPanelId;
  selectedTool: number;
  selectedSitemapItem: number;
  selectedVulnItem: number;
  chatInput: string;
}

export interface UseDashboardLayoutResult {
  contentHeight: number;
  leftPanelWidth: number;
  rightPanelWidth: number;
  centerPanelWidth: number;
  leftPanelTopHeight: number;
  leftPanelBottomHeight: number;
  sitemapScrollHeight: number;
  sitemapScrollWidth: number;
  vulnsScrollHeight: number;
  vulnsScrollWidth: number;
}

export interface Tool {
  id: ToolName;
  name: string;
  description: string;
  icon: string;
}
