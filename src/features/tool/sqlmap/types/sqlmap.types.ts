import { ToolData } from "../../shared/types/tool-screen.types";

export type SqlmapHttpMethod = "GET" | "POST";

export type SqlmapFieldId =
  | "targetUrl"
  | "method"
  | "parameter"
  | "body"
  | "level"
  | "risk"
  | "timeLimitSeconds"
  | "extraSafeOptions";

export interface SqlmapFormState extends Record<string, unknown> {
  targetUrl: string;
  method: SqlmapHttpMethod;
  parameter: string;
  body: string;
  level: string;
  risk: string;
  timeLimitSeconds: string;
  extraSafeOptions: string;
}

export interface SqlmapToolData extends ToolData {
  form: SqlmapFormState;
  selectedField: number;
}
