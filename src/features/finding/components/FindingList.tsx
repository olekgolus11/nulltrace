import { theme } from "../../../app/theme/theme";
import { SessionFindingRecord } from "../model/finding.types";
import {
  severityConfig,
  severityLabels,
} from "../model/finding-summary.constants";

interface FindingListProps {
  findings: SessionFindingRecord[];
  selectedIndex: number;
  focused: boolean;
}

const reviewStatusConfig: Record<
  SessionFindingRecord["reviewStatus"],
  { color: string; label: string }
> = {
  needs_review: { color: theme.accent.warning, label: "[NR]" },
  confirmed: { color: theme.accent.primary, label: "[OK]" },
  dismissed: { color: theme.text.muted, label: "[NO]" },
};

export function FindingList({
  findings,
  selectedIndex,
  focused,
}: FindingListProps) {
  function toSingleLine(value: string) {
    return value.replace(/\s+/g, " ").trim();
  }

  if (findings.length === 0) {
    return (
      <box flexDirection="column">
        <text fg={theme.text.secondary}>
          No findings recorded for this session yet.
        </text>
      </box>
    );
  }

  const rows = findings.map((finding) => {
    const severityLabel = severityLabels[finding.severity];
    const reviewStatusLabel = reviewStatusConfig[finding.reviewStatus].label;
    const title = toSingleLine(finding.title);
    const summary = toSingleLine(finding.summary);

    return {
      finding,
      severityLabel,
      reviewStatusLabel,
      title,
      summary,
      titleLineWidth:
        severityLabel.length + 1 + reviewStatusLabel.length + 1 + title.length,
      summaryLineWidth: summary.length,
    };
  });
  const listWidth = Math.max(
    1,
    ...rows.flatMap((row) => [row.titleLineWidth, row.summaryLineWidth]),
  );

  return (
    <box flexDirection="column" width={listWidth}>
      {rows.map((row, idx) => {
        const { finding, severityLabel, reviewStatusLabel, title, summary } =
          row;
        const isSelected = focused && idx === selectedIndex;
        const reviewStatus = reviewStatusConfig[finding.reviewStatus];

        return (
          <box
            key={finding.id}
            flexDirection="column"
            width={listWidth}
            backgroundColor={isSelected ? theme.bg.elevated : undefined}
          >
            <box flexDirection="row" width={listWidth}>
              <text fg={severityConfig[finding.severity].color}>
                <strong>{severityLabel}</strong>
              </text>
              <text fg={theme.text.dim}> </text>
              <text fg={reviewStatus.color}>
                <strong>{reviewStatusLabel}</strong>
              </text>
              <text fg={theme.text.dim}> </text>
              <text fg={isSelected ? theme.accent.primary : theme.text.primary}>
                {isSelected ? <strong>{title}</strong> : title}
              </text>
            </box>
            <box width={listWidth}>
              <text fg={theme.text.secondary}>{summary}</text>
            </box>
          </box>
        );
      })}
    </box>
  );
}
