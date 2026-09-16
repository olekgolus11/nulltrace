import { theme } from "../../../app/theme/theme";
import { FindingReviewStatus } from "./finding.types";
import { Severity } from "./finding-summary.types";

export const severityConfig: Record<Severity, { color: string; label: string }> = {
  critical: { color: theme.severity.critical, label: "CRITICAL" },
  high: { color: theme.severity.high, label: "HIGH" },
  medium: { color: theme.severity.medium, label: "MED" },
  low: { color: theme.severity.low, label: "LOW" },
  info: { color: theme.severity.info, label: "INFO" },
};

export const severityLabels: Record<Severity, string> = {
  critical: "[C]",
  high: "[H]",
  medium: "[M]",
  low: "[L]",
  info: "[I]",
};

export const reviewStatusConfig: Record<
  FindingReviewStatus,
  { color: string; marker: string; label: string }
> = {
  needs_review: {
    color: theme.accent.warning,
    marker: "[NR]",
    label: "Needs review",
  },
  confirmed: {
    color: theme.accent.primary,
    marker: "[OK]",
    label: "Confirmed",
  },
  dismissed: {
    color: theme.text.muted,
    marker: "[NO]",
    label: "Dismissed",
  },
};
