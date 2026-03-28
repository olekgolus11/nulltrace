import { theme } from "../../../app/theme/theme";
import { flattenSessionRows } from "../model/session-list";
import { SessionListProps } from "../model/session.types";
import { SessionItem } from "./SessionItem";
import { SessionTargetItem } from "./SessionTargetItem";

export function SessionList({
  targets,
  expandedTargetIds,
  selectedIndex,
  title = "Previous Sessions",
  focused,
}: SessionListProps) {
  const rows = flattenSessionRows(targets, expandedTargetIds);
  const totalSessions = targets.reduce(
    (sessionCount, target) => sessionCount + target.sessionCount,
    0,
  );

  return (
    <box flexDirection="column" flexGrow={1}>
      <box marginBottom={1}>
        <text fg={theme.accent.primary}>
          <strong>◆ {title}</strong>
        </text>
      </box>

      <box flexDirection="column" gap={0}>
        {rows.map((row, idx) => {
          const isSelected = idx === selectedIndex && focused;

          if (row.type === "target") {
            const target = targets.find((item) => item.id === row.targetId);
            if (!target) {
              return null;
            }

            return (
              <SessionTargetItem
                key={target.id}
                target={target}
                isExpanded={expandedTargetIds[target.id] !== false}
                isSelected={isSelected}
              />
            );
          }

          const target = targets.find((item) => item.id === row.targetId);
          const session = target?.sessions.find(
            (item) => item.id === row.sessionId,
          );

          if (!session) {
            return null;
          }

          return (
            <SessionItem
              key={session.id}
              session={session}
              isSelected={isSelected}
            />
          );
        })}
      </box>

      <box flexGrow={1} />
      <box>
        <text fg={theme.text.dim}>
          {targets.length} targets · {totalSessions} sessions
        </text>
      </box>
    </box>
  );
}
