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
  // The dashboard body fills whatever vertical space remains below chrome.
  const contentHeight = height - headerHeight - statusBarHeight;

  // Calculate scrollbox dimensions for left panels.
  // Both Sitemap and Vulns panels split the left column evenly (flexGrow=1).
  // Each gets roughly half of contentHeight.
  const leftPanelHalf = Math.floor(contentHeight / 2);

  // Both left panels use the same border + padding chrome, so the viewport
  // needs to exclude the full inner frame area.
  const innerPanelHeight = Math.max(1, leftPanelHalf - 3);
  const innerPanelWidth = Math.max(1, leftPanelWidth - 4);

  return {
    contentHeight,
    leftPanelWidth,
    rightPanelWidth,
    centerPanelWidth,
    sitemapScrollHeight: innerPanelHeight,
    sitemapScrollWidth: innerPanelWidth,
    vulnsScrollHeight: innerPanelHeight,
    vulnsScrollWidth: innerPanelWidth,
  };
};
