export interface PreparedAuthenticatedNucleiRun {
  command: string;
  secretFilePath: string;
  cleanup: () => void;
}
