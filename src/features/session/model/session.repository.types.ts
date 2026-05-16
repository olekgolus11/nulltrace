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

interface ToolRunLogLine {
  seq: number;
  stream: string;
  line: string;
  createdAt: string;
}

export interface ToolRunArtifactInput {
  artifactType: string;
  label: string;
  source: string;
  payload: unknown;
}

export interface ToolRunArtifactRecord extends ToolRunArtifactInput {
  id: string;
  toolRunId: string;
  createdAt: string;
}

export interface ToolRunDetail extends ToolRunSummary {
  logs: ToolRunLogLine[];
  artifacts: ToolRunArtifactRecord[];
}
