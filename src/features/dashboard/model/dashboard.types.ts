import { ToolName } from "../../tool/shared/types/tool-screen.types";

export interface DashboardScreenProps {
  sessionId: string;
  targetUrl: string;
  onSelectTool: (toolName: ToolName, targetUrl: string, sessionId: string) => void;
  onBack: () => void;
}

export interface UseDashboardShortcutsProps {
  sessionId: string;
  targetUrl: string;
  onBack: () => void;
  onSelectTool: (toolName: ToolName, targetUrl: string, sessionId: string) => void;
}

export interface PanelProps {
  title?: string;
  children: React.ReactNode;
  width?: number;
  height?: number;
  flexGrow?: number;
  flexDirection?: "row" | "column";
  border?: boolean;
  borderColor?: string;
  focused?: boolean;
  marginBottom?: number;
  padding?: number;
  paddingLeft?: number;
  paddingRight?: number;
  paddingTop?: number;
  paddingBottom?: number;
}

export interface UseDashboardLayoutProps {
  width: number;
  height: number;
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

export interface ToolCardProps {
  tool: Tool;
  isSelected: boolean;
}

export interface ToolListProps {
  tools: Tool[];
  selectedIndex: number;
  focused: boolean;
}
