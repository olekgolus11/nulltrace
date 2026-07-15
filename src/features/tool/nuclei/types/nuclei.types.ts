import { ToolData } from "../../shared/types/tool-screen.types";

export type NucleiSeverityPreset = "all" | "medium+" | "high+" | "critical";

export type NucleiFieldId =
  | "target"
  | "severityPreset"
  | "tags"
  | "templatesPath"
  | "extraArgs"
  | "useAuthenticatedContext";

export interface NucleiAuthenticationState {
  strategy: "none" | "session";
  isAvailable: boolean;
  origin: string | null;
}

export interface NucleiHeadersPlaceholder {
  entries: [];
}

export interface NucleiTemplateManagementPlaceholder {
  source: "external";
}

export interface NucleiFutureSlots {
  headers: NucleiHeadersPlaceholder;
  templateManagement: NucleiTemplateManagementPlaceholder;
}

export interface NucleiFormState extends Record<string, unknown> {
  target: string;
  severityPreset: NucleiSeverityPreset;
  tags: string;
  templatesPath: string;
  extraArgs: string;
  useAuthenticatedContext: boolean;
}

export interface NucleiToolData extends ToolData {
  form: NucleiFormState;
  selectedField: number;
  authentication: NucleiAuthenticationState;
  future: NucleiFutureSlots;
}
