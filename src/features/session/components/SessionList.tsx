import { theme } from "../../../app/theme/theme";
import { SessionListProps, SessionSidebarRow } from "../model/session.types";
import { SessionItem } from "./SessionItem";
import { SessionTargetItem } from "./SessionTargetItem";

function getSummaryCounts(rows: SessionSidebarRow[]) {
  return rows.reduce(
    (summary, row) => {
      if (row.type === "target") {
        summary.targetCount += 1;
      }
      if (row.type === "session") {
        summary.sessionCount += 1;
      }
      return summary;
    },
    { targetCount: 0, sessionCount: 0 },
  );
}

export function SessionList({
  rows,
  selectedIndex,
  title = "Previous Sessions",
  focused,
}: SessionListProps) {
  const summary = getSummaryCounts(rows);

  return (
    <box flexDirection="column" flexGrow={1}>
      <box marginBottom={1} flexDirection="column">
        <text fg={theme.accent.primary}>
          <strong>◆ {title}</strong>
        </text>
      </box>

      <box flexDirection="column">
        {rows.map((row, index) =>
          row.type === "target" ? (
            <SessionTargetItem
              key={row.id}
              target={row.target}
              isExpanded={row.isExpanded}
              isSelected={index === selectedIndex && focused}
            />
          ) : (
            <SessionItem
              key={row.id}
              session={row.session}
              isSelected={index === selectedIndex && focused}
              isCurrent={row.isCurrent}
              isLatest={row.isLatest}
            />
          ),
        )}
      </box>

      <box flexGrow={1} />
      <box>
        <text fg={theme.text.dim}>{summary.targetCount} targets</text>
      </box>
    </box>
  );
}
