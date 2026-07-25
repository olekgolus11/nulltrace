import { ToolData } from "../../shared/types/tool-screen.types";

export type FfufFieldId =
  | "targetPattern"
  | "wordlist"
  | "extensions"
  | "recursion"
  | "recursionDepth"
  | "matchCodes"
  | "filterCodes"
  | "rate"
  | "timeLimit";

export interface FfufContentDiscoveryFormState extends Record<string, unknown> {
  targetPattern: string;
  wordlist: string;
  extensions: string;
  recursion: boolean;
  recursionDepth: string;
  matchCodes: string;
  filterCodes: string;
  rate: string;
  timeLimit: string;
}

export interface FfufToolData extends ToolData {
  mode: "content_discovery";
  form: FfufContentDiscoveryFormState;
  selectedField: number;
}

export interface FfufArtifactResult {
  url: string;
  status: number;
  input: Record<string, string>;
  length: number | null;
  words: number | null;
  lines: number | null;
  redirectLocation: string | null;
  position: number | null;
}

export interface ParsedFfufOutput {
  results: FfufArtifactResult[];
  parseErrorCount: number;
}

export interface FfufSitemapMatch {
  normalizedUrl: string;
  path: string;
  httpStatus: number;
  depth: number;
}

export interface FfufFormProps {
  form: FfufContentDiscoveryFormState;
  selectedField: number;
  focused: boolean;
  onFieldChange: (field: keyof FfufContentDiscoveryFormState, value: string | boolean) => void;
}
