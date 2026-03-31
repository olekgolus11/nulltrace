import { RGBA } from "@opentui/core";

// Cyber Teal Theme - Color palette for Nulltrace TUI
export const theme = {
  // Backgrounds
  bg: {
    primary: "#0a0f1a", // Deep Navy - main background
    panel: "#111827", // Dark Slate - panel backgrounds
    elevated: "#1e293b", // Slightly lighter for elevated elements
    input: "#0f172a", // Input field background
    overlay: RGBA.fromInts(0, 0, 0, 140), // Semi-transparent modal overlay
  },

  // Accent colors
  accent: {
    primary: "#00d4aa", // Cyan/Teal - primary accent
    secondary: "#3b82f6", // Electric Blue - secondary accent
    warning: "#f59e0b", // Amber - warnings/highlights
    critical: "#ef4444", // Coral Red - critical/alerts
    high: "#f97316", // Orange - high severity
    medium: "#eab308", // Yellow - medium severity
    low: "#22c55e", // Green - low severity
    info: "#06b6d4", // Cyan - info messages
  },

  // Text colors
  text: {
    primary: "#e2e8f0", // Off-White - primary text
    secondary: "#94a3b8", // Light Slate - secondary text
    muted: "#64748b", // Slate Gray - muted text
    dim: "#475569", // Dim text
    inverse: "#0a0f1a", // Dark text on light backgrounds
  },

  // Border colors
  border: {
    default: "#1e293b", // Subtle border
    focus: "#00d4aa", // Focused element border
    muted: "#334155", // Muted border
  },

  // Severity colors for vulnerabilities
  severity: {
    critical: "#ef4444",
    high: "#f97316",
    medium: "#eab308",
    low: "#22c55e",
    info: "#3b82f6",
  },

  // Chat-specific colors
  chat: {
    ai: "#00d4aa", // AI message accent
    user: "#3b82f6", // User message accent
    system: "#64748b", // System message
  },
} as const;

// ASCII box drawing characters for panels
export const boxChars = {
  topLeft: "┌",
  topRight: "┐",
  bottomLeft: "└",
  bottomRight: "┘",
  horizontal: "─",
  vertical: "│",
  teeRight: "├",
  teeLeft: "┤",
  teeDown: "┬",
  teeUp: "┴",
  cross: "┼",
} as const;

// Tree drawing characters for sitemap
export const treeChars = {
  branch: "├──",
  lastBranch: "└──",
  vertical: "│  ",
  empty: "   ",
} as const;
