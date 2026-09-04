interface UseToolLayoutProps {
  width: number;
  height: number;
}

interface UseToolLayoutResult {
  contentHeight: number;
  leftPanelWidth: number;
  rightPanelWidth: number;
  workspacePanelWidth: number;
  historyPanelWidth: number;
  formPanelHeight: number;
  commandPanelHeight: number;
  outputPanelHeight: number;
  outputScrollHeight: number;
}

export function useToolLayout({ width, height }: UseToolLayoutProps): UseToolLayoutResult {
  const leftPanelWidth = Math.min(44, Math.max(30, Math.floor(width * 0.34)));
  const rightPanelWidth = Math.max(35, width - leftPanelWidth);
  const historyPanelWidth =
    rightPanelWidth >= 72
      ? Math.min(34, Math.max(26, Math.floor(rightPanelWidth * 0.3)))
      : Math.min(24, Math.max(18, Math.floor(rightPanelWidth * 0.32)));
  const workspacePanelWidth = Math.max(25, rightPanelWidth - historyPanelWidth);
  const headerHeight = 3;
  const statusBarHeight = 1;
  const contentHeight = Math.max(12, height - headerHeight - statusBarHeight);

  const formPanelHeight = Math.min(16, Math.max(12, Math.floor(contentHeight * 0.46)));
  const commandPanelHeight = Math.max(6, Math.min(8, Math.floor(contentHeight * 0.25)));
  const outputPanelHeight = Math.max(6, contentHeight - formPanelHeight - commandPanelHeight);

  return {
    contentHeight,
    leftPanelWidth,
    rightPanelWidth,
    workspacePanelWidth,
    historyPanelWidth,
    formPanelHeight,
    commandPanelHeight,
    outputPanelHeight,
    outputScrollHeight: Math.max(1, outputPanelHeight - 4),
  };
}
