import {
  SessionSidebarRow,
  TargetSummary,
} from "./session.types";

export function getInitialExpandedTargetIds(
  targets: TargetSummary[],
): Record<string, boolean> {
  return targets.reduce<Record<string, boolean>>((expandedTargetIds, target) => {
    expandedTargetIds[target.id] = true;
    return expandedTargetIds;
  }, {});
}

export function flattenSessionRows(
  targets: TargetSummary[],
  expandedTargetIds: Record<string, boolean>,
) {
  return targets.reduce<SessionSidebarRow[]>((rows, target) => {
    rows.push({
      type: "target",
      targetId: target.id,
    });

    if (expandedTargetIds[target.id] === false) {
      return rows;
    }

    target.sessions.forEach((session) => {
      rows.push({
        type: "session",
        targetId: target.id,
        sessionId: session.id,
      });
    });

    return rows;
  }, []);
}
