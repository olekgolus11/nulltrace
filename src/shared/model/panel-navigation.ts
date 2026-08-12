import { PanelDefinition, PanelDirection } from "./panel-navigation.types";

export function cyclePanel<TPanel extends string>(
  panels: Array<PanelDefinition<TPanel>>,
  currentPanel: TPanel,
  direction: PanelDirection,
): TPanel {
  const currentIndex = panels.findIndex((panel) => panel.id === currentPanel);
  const safeIndex = currentIndex === -1 ? 0 : currentIndex;
  const nextIndex = (safeIndex + direction + panels.length) % panels.length;
  return panels[nextIndex]?.id ?? currentPanel;
}
