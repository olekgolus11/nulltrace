import { ToolData } from "../../shared/types/tool-screen.types";

export type NucleiSeverityPreset = "all" | "medium+" | "high+" | "critical";

export type NucleiFieldId =
  | "target"
  | "severityPreset"
  | "tags"
  | "templatesPath"
  | "extraArgs";

export interface NucleiAuthPlaceholder {
  strategy: "none";
}

export interface NucleiHeadersPlaceholder {
  entries: [];
}

export interface NucleiTemplateManagementPlaceholder {
  source: "external";
}

export interface NucleiFutureSlots {
  auth: NucleiAuthPlaceholder;
  headers: NucleiHeadersPlaceholder;
  templateManagement: NucleiTemplateManagementPlaceholder;
}

export interface NucleiFormState extends Record<string, unknown> {
  target: string;
  severityPreset: NucleiSeverityPreset;
  tags: string;
  templatesPath: string;
  extraArgs: string;
}

export interface NucleiToolData extends ToolData {
  form: NucleiFormState;
  selectedField: number;
  future: NucleiFutureSlots;
}
