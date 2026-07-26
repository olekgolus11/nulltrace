import { ToolData } from "../../shared/types/tool-screen.types";

export type FfufMode = "content_discovery" | "parameter_discovery";

export type FfufParameterLocation = "query" | "body" | "header";

export type FfufContentDiscoveryFieldId =
  | "targetPattern"
  | "wordlist"
  | "extensions"
  | "recursion"
  | "recursionDepth"
  | "matchCodes"
  | "filterCodes"
  | "rate"
  | "timeLimit";

export type FfufParameterDiscoveryFieldId =
  | "endpoint"
  | "requestLocation"
  | "wordlist"
  | "matchCodes"
  | "filterCodes"
  | "rate"
  | "timeLimit";

export type FfufFieldId =
  | "mode"
  | FfufContentDiscoveryFieldId
  | FfufParameterDiscoveryFieldId;

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

export interface FfufParameterDiscoveryFormState extends Record<string, unknown> {
  endpoint: string;
  requestLocation: FfufParameterLocation;
  wordlist: string;
  matchCodes: string;
  filterCodes: string;
  rate: string;
  timeLimit: string;
}

export interface FfufContentDiscoveryToolData extends ToolData {
  mode: "content_discovery";
  form: FfufContentDiscoveryFormState;
  selectedField: number;
}

export interface FfufParameterDiscoveryToolData extends ToolData {
  mode: "parameter_discovery";
  form: FfufParameterDiscoveryFormState;
  selectedField: number;
}

export type FfufToolData = FfufContentDiscoveryToolData | FfufParameterDiscoveryToolData;

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

export interface FfufParameterCandidate {
  parameterName: string;
  requestLocation: FfufParameterLocation;
  response: {
    status: number;
    size: number | null;
    signature: {
      words: number | null;
      lines: number | null;
    };
  };
  provenance: {
    toolRunId: string;
    endpoint: string;
    mode: "parameter_discovery";
  };
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
  toolData: FfufToolData;
  focused: boolean;
  onFieldChange: (
    field: Exclude<FfufFieldId, "mode">,
    value: string | boolean,
  ) => void;
}
