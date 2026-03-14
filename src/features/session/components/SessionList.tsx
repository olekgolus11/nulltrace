import { theme } from "../../../app/theme/theme";
import { SessionListProps } from "../model/session.types";
import { SessionItem } from "./SessionItem";

export function SessionList({
  sessions,
  selectedIndex,
  title = "Previous Sessions",
  focused,
}: SessionListProps) {
  return (
    <box flexDirection="column" flexGrow={1}>
      <box marginBottom={1}>
        <text fg={theme.accent.primary}>
          <strong>◆ {title}</strong>
        </text>
      </box>

      <box flexDirection="column" gap={0}>
        {sessions.map((session, idx) => (
          <SessionItem
            key={session.url}
            session={session}
            isSelected={idx === selectedIndex && focused}
          />
        ))}
      </box>

      <box flexGrow={1} />
      <box>
        <text fg={theme.text.dim}>{sessions.length} sessions total</text>
      </box>
    </box>
  );
}
