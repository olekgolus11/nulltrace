import { theme } from "../../../app/theme/theme";
import { SessionSummary } from "../model/session.types";

interface SessionItemProps {
  session: SessionSummary;
  isSelected: boolean;
  isCurrent?: boolean;
  isLatest?: boolean;
  onMouseDown?: () => void;
}

function formatTimestamp(value: string) {
  return new Date(value).toLocaleString([], {
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  });
}

function getSessionBadges({ isCurrent, isLatest }: { isCurrent: boolean; isLatest: boolean }) {
  const badges: string[] = [];

  if (isCurrent) {
    badges.push("current");
  }

  if (isLatest) {
    badges.push("latest");
  }

  return badges.join(" · ");
}

export function SessionItem({
  session,
  isSelected,
  isCurrent = false,
  isLatest = false,
  onMouseDown,
}: SessionItemProps) {
  const badgeText = getSessionBadges({ isCurrent, isLatest });

  return (
    <box
      flexDirection="column"
      paddingLeft={2}
      paddingBottom={1}
      onMouseDown={onMouseDown ? (event) => {
        if (event.button !== 0) {
          return;
        }
        event.stopPropagation();
        onMouseDown();
      } : undefined}
    >
      <text fg={isSelected ? theme.accent.primary : theme.text.secondary}>
        {isSelected ? (
          <strong>└─ {formatTimestamp(session.createdAt)}</strong>
        ) : (
          `└─ ${formatTimestamp(session.createdAt)}`
        )}
      </text>
      {badgeText ? (
        <text fg={theme.text.dim} paddingLeft={3}>
          {badgeText}
        </text>
      ) : null}
    </box>
  );
}
