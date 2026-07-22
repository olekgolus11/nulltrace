import { theme } from "../../../app/theme/theme";
import { FindingSummaryProps } from "../model/finding-summary.types";

export function FindingCounts({ critical, high, medium, low, info }: FindingSummaryProps) {
  return (
    <box flexDirection="row" gap={2}>
      <text fg={theme.severity.critical}>
        <strong>{critical} Critical</strong>
      </text>
      <text fg={theme.severity.high}>
        <strong>{high} High</strong>
      </text>
      <text fg={theme.severity.medium}>
        <strong>{medium} Medium</strong>
      </text>
      <text fg={theme.severity.low}>
        <strong>{low} Low</strong>
      </text>
      <text fg={theme.severity.info}>
        <strong>{info} Info</strong>
      </text>
    </box>
  );
}
