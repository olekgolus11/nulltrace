import { FfufToolData } from "../types/ffuf.types";

export interface PrepareAuthenticatedFfufRunInput {
  sessionId: string;
  targetUrl: string;
  command: string;
  toolData: FfufToolData;
  artifactOutputPath: string;
}

export interface PreparedAuthenticatedFfufRun {
  command: string;
  secretFilePath: string;
  cleanup: () => void;
  prepareArtifacts: () => void;
  redactOutput: (content: string) => string;
  redactArtifact: (content: string) => string;
}
