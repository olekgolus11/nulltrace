import { UseToolLayoutProps, UseToolLayoutResult } from "../model/tool.types";

export function useToolLayout({
  width,
  height,
}: UseToolLayoutProps): UseToolLayoutResult {
  const leftPanelWidth = Math.min(44, Math.max(34, Math.floor(width * 0.34)));
  const rightPanelWidth = Math.max(40, width - leftPanelWidth);
  const headerHeight = 3;
  const statusBarHeight = 3;
  const contentHeight = Math.max(12, height - headerHeight - statusBarHeight);

  const formPanelHeight = Math.min(16, Math.max(14, Math.floor(contentHeight * 0.46)));
  const commandPanelHeight = 8;
  const outputPanelHeight = Math.max(
    8,
    contentHeight - formPanelHeight - commandPanelHeight,
  );

  return {
    contentHeight,
    leftPanelWidth,
    rightPanelWidth,
    formPanelHeight,
    commandPanelHeight,
    outputPanelHeight,
    outputScrollHeight: Math.max(1, outputPanelHeight - 4),
  };
}
