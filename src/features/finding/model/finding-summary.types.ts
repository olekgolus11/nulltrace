export type Severity = "critical" | "high" | "medium" | "low" | "info";

export interface FindingSummaryProps {
  critical: number;
  high: number;
  medium: number;
  low: number;
  info: number;
  total: number;
}
