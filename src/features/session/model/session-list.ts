import {
  SessionSidebarRow,
  SessionSummary,
  TargetSummary,
} from "./session.types";

export function getInitialExpandedTargetId(targets: TargetSummary[]) {
  return targets[0]?.id ?? null;
}

function getLatestSessionId(sessions: SessionSummary[]) {
  return sessions[0]?.id ?? null;
}

export function buildSessionSidebarRows(
  targets: TargetSummary[],
  expandedTargetId: string | null,
  currentSessionId: string | null,
) {
  return targets.reduce<SessionSidebarRow[]>((rows, target) => {
    rows.push({
      type: "target",
      id: target.id,
      target,
      isExpanded: target.id === expandedTargetId,
      latestSessionId: getLatestSessionId(target.sessions),
    });

    if (target.id !== expandedTargetId) {
      return rows;
    }

    target.sessions.forEach((session, sessionIndex) => {
      rows.push({
        type: "session",
        id: session.id,
        target,
        session,
        isCurrent: session.id === currentSessionId,
        isLatest: sessionIndex === 0,
      });
    });

    return rows;
  }, []);
}
