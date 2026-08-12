export interface PrepareAuthenticatedCurlRunInput {
  sessionId: string;
  targetUrl: string;
  command: string;
}

export interface PreparedAuthenticatedCurlRun {
  command: string;
  configPath: string;
  authenticationOrigin: string;
  cleanup: () => void;
  redactOutput: (content: string) => string;
}
