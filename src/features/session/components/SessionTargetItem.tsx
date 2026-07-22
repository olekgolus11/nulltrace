import { theme } from "../../../app/theme/theme";
import { TargetSummary } from "../model/session.types";

interface SessionTargetItemProps {
  target: TargetSummary;
  isExpanded: boolean;
  isSelected: boolean;
}

function formatRelativeCount(count: number) {
  return `${count} ${count === 1 ? "session" : "sessions"}`;
}

function formatLastActivity(value: string) {
  return new Date(value).toLocaleString([], {
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  });
}

export function SessionTargetItem({ target, isExpanded, isSelected }: SessionTargetItemProps) {
  const marker = isExpanded ? "▾" : "▸";
  const summaryText = `${formatRelativeCount(target.sessionCount)} · ${formatLastActivity(target.lastActivityAt)}`;

  return (
    <box flexDirection="column" paddingTop={1} paddingBottom={1}>
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
