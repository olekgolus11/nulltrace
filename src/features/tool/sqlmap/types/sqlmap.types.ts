import { ToolData } from "../../shared/types/tool-screen.types";

export type SqlmapHttpMethod = "GET" | "POST";

export interface SqlmapValidatedCommandOption {
  name: string;
  value: string | null;
}

export interface SqlmapValidatedCommand {
  options: SqlmapValidatedCommandOption[];
  method: SqlmapHttpMethod;
  parameter: string;
  targetUrl: string;
  body: string | null;
}

export type SqlmapFieldId =
  | "targetUrl"
  | "method"
  | "parameter"
  | "body"
  | "level"
  | "risk"
  | "timeLimitSeconds"
  | "useAuthenticatedContext"
  | "extraSafeOptions";

export interface SqlmapAuthenticationState {
  strategy: "none" | "session";
  isAvailable: boolean;
  origin: string | null;
}

export interface SqlmapFormState extends Record<string, unknown> {
  targetUrl: string;
  method: SqlmapHttpMethod;
  parameter: string;
  body: string;
  level: string;
  risk: string;
  timeLimitSeconds: string;
  useAuthenticatedContext: boolean;
  extraSafeOptions: string;
}

export interface SqlmapToolData extends ToolData {
  form: SqlmapFormState;
  selectedField: number;
  authentication: SqlmapAuthenticationState;
}
