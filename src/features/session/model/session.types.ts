export interface SessionSummary {
  id: string;
  targetId: string;
  displayUrl: string;
  createdAt: string;
  lastActivityAt: string;
}

export interface TargetSummary {
  id: string;
  normalizedUrl: string;
  displayUrl: string;
  createdAt: string;
  lastActivityAt: string;
  sessionCount: number;
  sessions: SessionSummary[];
}

export type SessionSidebarRow =
  | {
      type: "target";
      id: string;
      target: TargetSummary;
      isExpanded: boolean;
      latestSessionId: string | null;
    }
  | {
      type: "session";
      id: string;
      target: TargetSummary;
      session: SessionSummary;
      isCurrent: boolean;
      isLatest: boolean;
    };
