import { expect, test } from "bun:test";
import { createStatusBarReadModel } from "../status-bar.helpers";

const panels = [
  { id: "sitemap", label: "SITEMAP" },
  { id: "findings", label: "FINDINGS" },
  { id: "chat", label: "AI CHAT" },
];

const hints = [
  { key: "Tab/Shift+Tab", label: "switch" },
  { key: "Ctrl+1-4", label: "jump" },
  { key: "Ctrl+A", label: "auth" },
  { key: "Enter", label: "select" },
  { key: "ESC", label: "back" },
  { key: "Ctrl+Q", label: "quit" },
];

test("keeps every priority-ordered hint at wide widths", () => {
  const readModel = createStatusBarReadModel({
    activePanel: "findings",
    hints,
    panels,
    width: 120,
  });

  expect(readModel).toEqual({
    activeIndicator: "[2 FINDINGS]",
    hasOmittedHints: false,
    hints,
  });
});

test("keeps the highest-priority hint prefix and a final ellipsis at medium widths", () => {
  const readModel = createStatusBarReadModel({
    activePanel: "findings",
    hints,
    panels,
    width: 60,
  });

  expect(readModel).toEqual({
    activeIndicator: "[2 FINDINGS]",
    hasOmittedHints: true,
    hints: hints.slice(0, 2),
  });
});

test("keeps only the ellipsis and active indicator at compact widths", () => {
  const readModel = createStatusBarReadModel({
    activePanel: "findings",
    hints,
    panels,
    width: 24,
  });

  expect(readModel).toEqual({
    activeIndicator: "[2 FINDINGS]",
    hasOmittedHints: true,
    hints: [],
  });
});

test("does not render a malformed partial active indicator below its fit threshold", () => {
  const readModel = createStatusBarReadModel({
    activePanel: "findings",
    hints,
    panels,
    width: 10,
  });

  expect(readModel.activeIndicator).toBe("");
  expect(readModel.hasOmittedHints).toBe(true);
});

test("uses terminal display cells for Unicode labels", () => {
  const readModel = createStatusBarReadModel({
    activePanel: "unicode",
    hints: [
      { key: "界", label: "wide" },
      { key: "é", label: "combined" },
    ],
    panels: [
      { id: "plain", label: "PLAIN" },
      { id: "unicode", label: "发现" },
    ],
    width: 22,
  });

  expect(readModel).toEqual({
    activeIndicator: "[2 发现]",
    hasOmittedHints: true,
    hints: [{ key: "界", label: "wide" }],
  });
});

test("derives the indicator directly from the current active panel", () => {
  const findingsModel = createStatusBarReadModel({
    activePanel: "findings",
    hints: [],
    panels,
    width: 40,
  });
  const chatModel = createStatusBarReadModel({
    activePanel: "chat",
    hints: [],
    panels,
    width: 40,
  });

  expect(findingsModel.activeIndicator).toBe("[2 FINDINGS]");
  expect(chatModel.activeIndicator).toBe("[3 AI CHAT]");
});

test("compacts finding-detail hints through the same policy", () => {
  const readModel = createStatusBarReadModel({
    activePanel: "findings",
    hints: [
      { key: "Up/Down", label: "scroll" },
      { key: "ESC", label: "close" },
    ],
    panels,
    width: 33,
  });

  expect(readModel).toEqual({
    activeIndicator: "[2 FINDINGS]",
    hasOmittedHints: true,
    hints: [{ key: "Up/Down", label: "scroll" }],
  });
});

test("keeps padding, separators, hints, and indicator inside each cell budget", () => {
  for (let width = 2; width <= 120; width += 1) {
    const readModel = createStatusBarReadModel({
      activePanel: "unicode",
      hints: [
        { key: "界", label: "wide" },
        { key: "é", label: "combined" },
        { key: "↑↓", label: "navigate" },
      ],
      panels: [
        { id: "plain", label: "PLAIN" },
        { id: "unicode", label: "发现" },
      ],
      width,
    });
    const renderedHints = readModel.hints
      .map((hint) => `${hint.key} ${hint.label}`)
      .join(" | ");
    const omittedSuffix = readModel.hasOmittedHints
      ? `${readModel.hints.length > 0 ? " | " : ""}…`
      : "";
    const hasLeftContent = renderedHints.length > 0 || omittedSuffix.length > 0;
    const renderedWidth =
      2 +
      Bun.stringWidth(renderedHints + omittedSuffix) +
      (hasLeftContent && readModel.activeIndicator ? 1 : 0) +
      Bun.stringWidth(readModel.activeIndicator);

    expect(renderedWidth).toBeLessThanOrEqual(width);
  }
});
