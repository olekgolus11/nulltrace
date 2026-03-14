import { theme } from "../../../app/theme/theme";
import { SessionItemProps } from "../model/session.types";

export function SessionItem({ session, isSelected }: SessionItemProps) {
  const vulnColor =
    session.vulns > 5
      ? theme.severity.critical
      : session.vulns > 0
        ? theme.severity.medium
        : theme.severity.low;

  return (
    <box
      flexDirection="column"
      backgroundColor={isSelected ? theme.bg.elevated : undefined}
      paddingLeft={1}
      paddingRight={1}
      paddingBottom={1}
      paddingTop={1}
    >
      <box>
        <text fg={isSelected ? theme.accent.primary : theme.text.primary}>
          {isSelected ? <strong>▸ {session.url}</strong> : `  ${session.url}`}
        </text>
      </box>
      <box flexDirection="row" paddingLeft={2}>
        <text fg={theme.text.dim}>{session.date}</text>
        <text fg={theme.text.dim}> · </text>
        <text fg={vulnColor}>{session.vulns} vulns</text>
      </box>
    </box>
  );
}
