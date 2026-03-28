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

export interface TargetListRow {
  type: "target";
  targetId: string;
}

export interface SessionListRow {
  type: "session";
  targetId: string;
  sessionId: string;
}

export type SessionSidebarRow = TargetListRow | SessionListRow;

export interface SessionItemProps {
  session: SessionSummary;
  isSelected: boolean;
}

export interface SessionTargetItemProps {
  target: TargetSummary;
  isExpanded: boolean;
  isSelected: boolean;
}

export interface SessionListProps {
  targets: TargetSummary[];
  expandedTargetIds: Record<string, boolean>;
  selectedIndex: number;
  title?: string;
  focused: boolean;
}
