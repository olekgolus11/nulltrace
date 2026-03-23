import { useTerminalDimensions } from "@opentui/react";
import {
  UseDashboardLayoutProps,
  UseDashboardLayoutResult,
} from "../model/dashboard.types";

export const useDashboardLayout = ({
  width,
  height,
}: UseDashboardLayoutProps): UseDashboardLayoutResult => {
  const leftPanelWidth = 40;
  const rightPanelWidth = 40;
  const centerPanelWidth = width - leftPanelWidth - rightPanelWidth;
  const headerHeight = 3;
  const statusBarHeight = 1;
  const contentHeight = height - headerHeight - statusBarHeight;

  // Calculate scrollbox dimensions for left panels.
  // Both Sitemap and Vulns panels split the left column evenly (flexGrow=1).
  // Each gets roughly half of contentHeight.
  const leftPanelHalf = Math.floor(contentHeight / 2);

  // Sitemap panel: title lives in the top border, so only the border consumes rows.
  const sitemapScrollHeight = Math.max(1, leftPanelHalf - 2);
  // Sitemap panel: border=2 cols, padding=0
  const sitemapScrollWidth = Math.max(1, leftPanelWidth - 2);

  // Vulns panel: title lives in the top border, so only border and padding consume rows.
  const vulnsScrollHeight = Math.max(1, leftPanelHalf - 2 - 2);
  // Vulns panel: border=2 cols, paddingLeft=1+paddingRight=1
  const vulnsScrollWidth = Math.max(1, leftPanelWidth - 2 - 2);

  return {
    contentHeight,
    leftPanelWidth,
    rightPanelWidth,
    centerPanelWidth,
    sitemapScrollHeight,
    sitemapScrollWidth,
    vulnsScrollHeight,
    vulnsScrollWidth,
  };
};
