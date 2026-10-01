import { theme } from "../../../app/theme/theme";
import { formatSessionTimestamp } from "../../../shared/model/date-time.helpers";
import { TargetSummary } from "../model/session.types";

interface SessionTargetItemProps {
  target: TargetSummary;
  isExpanded: boolean;
  isSelected: boolean;
  onMouseDown?: () => void;
}

function formatRelativeCount(count: number) {
  return `${count} ${count === 1 ? "session" : "sessions"}`;
}

export function SessionTargetItem({ target, isExpanded, isSelected, onMouseDown }: SessionTargetItemProps) {
  const marker = isExpanded ? "▾" : "▸";
  const summaryText = `${formatRelativeCount(target.sessionCount)} · ${formatSessionTimestamp(target.lastActivityAt)}`;

  return (
    <box
      flexDirection="column"
      paddingTop={1}
      paddingBottom={1}
      onMouseDown={onMouseDown ? (event) => {
        if (event.button !== 0) {
          return;
        }
        event.stopPropagation();
        onMouseDown();
      } : undefined}
    >
      <text fg={isSelected ? theme.accent.primary : theme.text.primary}>
        {isSelected ? (
          <strong>{`${marker} ${target.displayUrl}`}</strong>
        ) : (
          `${marker} ${target.displayUrl}`
        )}
      </text>
      <text fg={theme.text.dim} paddingLeft={2}>
        {summaryText}
      </text>
    </box>
  );
}
