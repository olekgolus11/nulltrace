export interface PreparedAuthenticatedNucleiRun {
  command: string;
  secretFilePath: string;
  cleanup: () => void;
  redactOutput: (content: string) => string;
  redactJsonl: (content: string) => string;
}
