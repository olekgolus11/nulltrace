import { ToolName } from "../../tool/shared/types/tool-screen.types";

export type DashboardPanelId = "sitemap" | "findings" | "chat" | "tools";

export interface DashboardState {
  activePanel: DashboardPanelId;
  selectedTool: number;
  selectedSitemapItem: number;
  selectedFindingItem: number;
  selectedFindingDetailId: string | null;
  isAuthenticationContextOpen: boolean;
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
  findingsScrollHeight: number;
  findingsScrollWidth: number;
}

export interface Tool {
  id: ToolName;
  name: string;
  description: string;
  icon: string;
}
