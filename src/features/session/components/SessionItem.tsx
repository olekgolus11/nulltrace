import { theme } from "../../../app/theme/theme";
import { SessionItemProps } from "../model/session.types";

export function SessionItem({ session, isSelected }: SessionItemProps) {
  return (
    <box
      flexDirection="column"
      backgroundColor={theme.bg.elevated}
      paddingLeft={1}
      paddingRight={1}
      paddingBottom={1}
    >
      <box>
        <text fg={isSelected ? theme.accent.primary : theme.text.primary}>
          {isSelected ? (
            <strong>
              ↳{"  "}
              {formatTimestamp(session.createdAt)}
            </strong>
          ) : (
            <strong>
              {"   "}
              {formatTimestamp(session.createdAt)}
            </strong>
          )}
        </text>
      </box>
    </box>
  );
}

function formatTimestamp(value: string) {
  return new Date(value).toLocaleString([], {
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  });
}
