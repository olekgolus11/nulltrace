import { ToolData } from "../../shared/types/tool-screen.types";

export type CurlHttpMethod =
  | "GET"
  | "HEAD"
  | "POST"
  | "PUT"
  | "PATCH"
  | "DELETE"
  | "OPTIONS";

export type CurlBodyMode = "text" | "json";

export type CurlFieldId =
  | "method"
  | "targetUrl"
  | "headers"
  | "bodyMode"
  | "body"
  | "useAuthenticatedContext";

export interface CurlAuthenticationState {
  strategy: "none" | "session";
  isAvailable: boolean;
  origin: string | null;
}

export interface CurlFormState extends Record<string, unknown> {
  method: CurlHttpMethod;
  targetUrl: string;
  headers: string;
  bodyMode: CurlBodyMode;
  body: string;
  useAuthenticatedContext: boolean;
}

export interface CurlToolData extends ToolData {
  form: CurlFormState;
  selectedField: number;
  authentication: CurlAuthenticationState;
}

export interface CurlValidatedCommand {
  method: CurlHttpMethod;
  targetUrl: string;
  tokens: string[];
}

