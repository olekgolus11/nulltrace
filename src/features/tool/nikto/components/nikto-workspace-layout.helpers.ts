const workspaceFooterHeight = 1;
const outputPanelChromeHeight = 3;

export function getNiktoOutputScrollHeight(
  contentHeight: number,
  formPanelHeight: number,
  commandPanelHeight: number,
): number {
  return Math.max(
    0,
    contentHeight -
      formPanelHeight -
      commandPanelHeight -
      workspaceFooterHeight -
      outputPanelChromeHeight,
  );
}
