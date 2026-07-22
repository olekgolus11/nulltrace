import { theme } from "../../../app/theme/theme";
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
