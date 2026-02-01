import { theme } from "../theme.ts";

interface Session {
  url: string;
  date: string;
  vulns: number;
}

interface SessionItemProps {
  session: Session;
  isSelected: boolean;
}

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
      marginBottom={1}
    >
      <box>
        <text fg={isSelected ? theme.accent.primary : theme.text.primary}>
          {isSelected ? (
            <strong>▸ {session.url}</strong>
          ) : (
            `  ${session.url}`
          )}
        </text>
      </box>
      <box paddingLeft={2}>
        <text fg={theme.text.dim}>{session.date}</text>
        <text fg={theme.text.dim}> · </text>
        <text fg={vulnColor}>{session.vulns} vulns</text>
      </box>
    </box>
  );
}

interface SessionListProps {
  sessions: Session[];
  selectedIndex: number;
  title?: string;
}

export function SessionList({
  sessions,
  selectedIndex,
  title = "Previous Sessions",
}: SessionListProps) {
  return (
    <box flexDirection="column" width={30} flexGrow={1}>
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
            isSelected={idx === selectedIndex}
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
