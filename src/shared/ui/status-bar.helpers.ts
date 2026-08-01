import {
  CreateStatusBarReadModelInput,
  StatusBarReadModel,
} from "./status-bar.types";

export function createStatusBarReadModel({
  activePanel,
  hints,
  panels,
  width,
}: CreateStatusBarReadModelInput): StatusBarReadModel {
  const activePanelIndex = panels.findIndex((panel) => panel.id === activePanel);
  const activeIndicatorCandidate =
    activePanelIndex === -1
      ? ""
      : `[${activePanelIndex + 1} ${panels[activePanelIndex]!.label}]`;
  const contentWidth = Math.max(0, width - horizontalPaddingWidth);
  const activeIndicator =
    Bun.stringWidth(activeIndicatorCandidate) <= contentWidth
      ? activeIndicatorCandidate
      : "";
  const activeIndicatorWidth = Bun.stringWidth(activeIndicator);
  const availableHintWidth = Math.max(
    0,
    contentWidth - activeIndicatorWidth - groupSeparatorWidth,
  );
  const fullHintsWidth = getHintsWidth(hints);

  if (fullHintsWidth <= availableHintWidth) {
    return {
      activeIndicator,
      hasOmittedHints: false,
      hints,
    };
  }

  const fittedHints = [];
  for (const hint of hints) {
    const candidateHints = [...fittedHints, hint];
    const candidateWidth =
      getHintsWidth(candidateHints) +
      (candidateHints.length > 0 ? Bun.stringWidth(hintSeparator) : 0) +
      Bun.stringWidth(omittedHintsIndicator);

    if (candidateWidth > availableHintWidth) {
      break;
    }
    fittedHints.push(hint);
  }

  return {
    activeIndicator,
    hasOmittedHints: Bun.stringWidth(omittedHintsIndicator) <= availableHintWidth,
    hints: fittedHints,
  };
}

const horizontalPaddingWidth = 2;
const groupSeparatorWidth = 1;
const hintSeparator = " | ";
const omittedHintsIndicator = "…";

function getHintsWidth(hints: CreateStatusBarReadModelInput["hints"]): number {
  return hints.reduce(
    (width, hint, index) =>
      width +
      (index > 0 ? Bun.stringWidth(hintSeparator) : 0) +
      Bun.stringWidth(`${hint.key} ${hint.label}`),
    0,
  );
}
