export interface TargetRecord {
  id: string;
  normalizedUrl: string;
  displayUrl: string;
  createdAt: string;
}

export interface SessionRecord {
  id: string;
  targetId: string;
  createdAt: string;
}

export interface TargetRow {
  id: string;
  normalizedUrl: string;
  displayUrl: string;
  createdAt: string;
  lastActivityAt: string;
  sessionCount: number;
}

export interface SessionRow {
  id: string;
  targetId: string;
  displayUrl: string;
  createdAt: string;
  lastActivityAt: string;
}

export interface SessionDetailRow {
  id: string;
  targetId: string;
  normalizedUrl: string;
  displayUrl: string;
  createdAt: string;
  lastActivityAt: string;
}

export interface ToolRunInput {
  toolName: string;
  command: string;
  commandSource: string;
  status: string;
}

export interface ToolRunRecord {
  id: string;
  sessionId: string;
  toolName: string;
  command: string;
  commandSource: string;
  status: string;
  startedAt: string;
  endedAt: string | null;
  exitCode: number | null;
}

export interface ToolRunSummary {
  id: string;
  toolName: string;
  command: string;
  commandSource: string;
  status: string;
  startedAt: string;
  endedAt: string | null;
  exitCode: number | null;
}

export interface ToolRunLogLine {
  seq: number;
  stream: string;
  line: string;
  createdAt: string;
}

export interface ToolRunDetail extends ToolRunSummary {
  logs: ToolRunLogLine[];
}

export interface FindingSnapshotInput {
  sourceTool: string;
  kind: string;
  severity: string;
  title: string;
  payload: unknown;
}
