import { expect, test } from "bun:test";
import { useToolLayout } from "../use-tool-layout";

test("fits tool columns and nested history inside their parent widths", () => {
  for (const width of [40, 60, 65, 80, 100, 120, 160]) {
    const layout = useToolLayout({ width, height: 40 });
    expect(layout.leftPanelWidth + layout.rightPanelWidth).toBe(width);
    expect(layout.workspacePanelWidth + layout.historyPanelWidth).toBe(layout.rightPanelWidth);
    expect(layout.workspacePanelWidth).toBeGreaterThan(0);
  }
});

test("preserves wide-terminal tool column widths", () => {
  const layout = useToolLayout({ width: 160, height: 40 });
  expect(layout.leftPanelWidth).toBe(44);
  expect(layout.historyPanelWidth).toBe(34);
});
