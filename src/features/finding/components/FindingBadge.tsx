import { severityConfig } from "../model/finding-summary.constants";
import { Severity } from "../model/finding-summary.types";

interface FindingBadgeProps {
  severity: Severity;
  count: number;
  width?: number;
}

export function FindingBadge({
  severity,
  count,
  width,
}: FindingBadgeProps) {
  const config = severityConfig[severity];

  return (
    <box width={width}>
      <text fg={config.color}>
        <strong>
          {config.label}: {count}
        </strong>
      </text>
    </box>
  );
}
