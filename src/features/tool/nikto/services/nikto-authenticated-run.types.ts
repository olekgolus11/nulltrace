export interface PreparedAuthenticatedNiktoRun {
  command: string;
  authenticationOrigin: string;
  secretFilePath: string;
  cleanup: () => void;
  prepareArtifacts: () => void;
  redactOutput: (content: string) => string;
  redactArtifact: (content: string) => string;
}

export interface PrepareAuthenticatedNiktoRunInput {
  sessionId: string;
  targetUrl: string;
  command: string;
  artifactOutputPath: string;
}
