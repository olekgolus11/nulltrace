export interface PrepareAuthenticatedSqlmapRunInput {
  sessionId: string;
  command: string;
}

export interface PreparedAuthenticatedSqlmapRun {
  command: string;
  secretFilePath: string;
  cleanup: () => void;
  redactOutput: (content: string) => string;
  redactArtifact: (content: string) => string;
}
