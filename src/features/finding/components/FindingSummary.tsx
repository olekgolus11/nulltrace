import { theme } from "../../../app/theme/theme";
import { FindingSummaryProps } from "../model/finding-summary.types";
import { FindingBadge } from "./FindingBadge";

export function FindingSummary({
  critical,
  high,
  medium,
  low,
  info,
  total,
}: FindingSummaryProps) {
  return (
    <box flexDirection="row" gap={4}>
      <FindingBadge severity="critical" count={critical} />
      <FindingBadge severity="high" count={high} />
      <FindingBadge severity="medium" count={medium} />
      <FindingBadge severity="low" count={low} />
      <FindingBadge severity="info" count={info} />
      <box flexGrow={1} />
      <box>
        <text fg={theme.text.secondary}>
          <strong>TOTAL: {total}</strong>
        </text>
      </box>
    </box>
  );
}
