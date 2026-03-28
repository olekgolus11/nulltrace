import { theme } from "../../../app/theme/theme";
import { SessionTargetItemProps } from "../model/session.types";

function formatRelativeCount(count: number) {
  return `${count} ${count === 1 ? "session" : "sessions"}`;
}

export function SessionTargetItem({
  target,
  isExpanded,
  isSelected,
}: SessionTargetItemProps) {
  const marker = isExpanded ? "▾" : "▸";

  return (
    <box
      flexDirection="column"
      backgroundColor={isExpanded || isSelected ? theme.bg.elevated : undefined}
      paddingLeft={1}
      paddingRight={1}
      paddingTop={1}
      paddingBottom={1}
    >
      <box>
        <text fg={isSelected ? theme.accent.primary : theme.text.primary}>
          {isSelected ? (
            <strong>{`${marker} ${target.displayUrl}`}</strong>
          ) : (
            `${marker} ${target.displayUrl}`
          )}
        </text>
      </box>
      <box paddingLeft={2}>
        <text fg={theme.text.dim}>
          {formatRelativeCount(target.sessionCount)}
        </text>
      </box>
    </box>
  );
}
