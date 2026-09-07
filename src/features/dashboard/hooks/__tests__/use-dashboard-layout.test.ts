import { expect, test } from "bun:test";
import { useDashboardLayout } from "../use-dashboard-layout";

test("fits dashboard columns and body within the terminal", () => {
  for (const width of [40, 60, 80, 100, 120, 160]) {
    const layout = useDashboardLayout({ width, height: 24 });
    expect(layout.leftPanelWidth + layout.centerPanelWidth + layout.rightPanelWidth).toBe(width);
    expect(layout.leftPanelTopHeight + layout.leftPanelBottomHeight).toBe(20);
  }
});

test("does not reserve body rows beyond a short terminal", () => {
  expect(useDashboardLayout({ width: 80, height: 8 }).contentHeight).toBe(4);
});
