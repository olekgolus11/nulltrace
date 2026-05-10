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

export interface SessionDetail {
  id: string;
  targetId: string;
  normalizedUrl: string;
  displayUrl: string;
  createdAt: string;
  lastActivityAt: string;
}

export interface SessionSidebarTargetRow {
  type: "target";
  id: string;
  target: TargetSummary;
  isExpanded: boolean;
  latestSessionId: string | null;
}

export interface SessionSidebarSessionRow {
  type: "session";
  id: string;
  target: TargetSummary;
  session: SessionSummary;
  isCurrent: boolean;
  isLatest: boolean;
}

export type SessionSidebarRow =
  | SessionSidebarTargetRow
  | SessionSidebarSessionRow;

export interface SessionItemProps {
  session: SessionSummary;
  isSelected: boolean;
  isCurrent?: boolean;
  isLatest?: boolean;
}

export interface SessionTargetItemProps {
  target: TargetSummary;
  isExpanded: boolean;
  isSelected: boolean;
}

export interface SessionListProps {
  rows: SessionSidebarRow[];
  selectedIndex: number;
  title?: string;
  focused: boolean;
}

export interface SessionContextState {
  sessionId: string | null;
  targetId: string | null;
  targetUrl: string;
  createSessionForTarget: (target: {
    id: string;
    normalizedUrl: string;
  }) => void;
  createSessionForNewTarget: (url: string) => void;
  openExistingSession: (sessionId: string) => boolean;
}
