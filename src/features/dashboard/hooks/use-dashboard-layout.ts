import { UseDashboardLayoutResult } from "../model/dashboard.types";

interface UseDashboardLayoutProps {
  width: number;
  height: number;
}

export const useDashboardLayout = ({
  width,
  height,
}: UseDashboardLayoutProps): UseDashboardLayoutResult => {
  const leftPanelWidth = 40;
  const rightPanelWidth = 40;
  const centerPanelWidth = width - leftPanelWidth - rightPanelWidth;
  const headerHeight = 3;
  const statusBarHeight = 1;
  // The dashboard body fills whatever vertical space remains below chrome.
  const contentHeight = height - headerHeight - statusBarHeight;

  // Split the left column explicitly so the top panel gets the extra row
  // when the available height is odd.
  const leftPanelTopHeight = Math.ceil(contentHeight / 2);
  const leftPanelBottomHeight = contentHeight - leftPanelTopHeight;

  // Sitemap can fill the full inner panel height. The bottom findings panel
  // keeps one row clear so its horizontal scrollbar does not draw into the
  // global status bar while still meeting the vertical scrollbar.
  const sitemapScrollHeight = Math.max(1, leftPanelTopHeight - 2);
  const findingsScrollHeight = Math.max(1, leftPanelBottomHeight - 3);
  const innerPanelWidth = Math.max(1, leftPanelWidth - 4);

  return {
    contentHeight,
    leftPanelWidth,
    rightPanelWidth,
    centerPanelWidth,
    leftPanelTopHeight,
    leftPanelBottomHeight,
    sitemapScrollHeight,
    sitemapScrollWidth: innerPanelWidth,
    findingsScrollHeight,
    findingsScrollWidth: innerPanelWidth,
  };
};
