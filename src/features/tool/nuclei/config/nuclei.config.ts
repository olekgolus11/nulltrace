import {
  NucleiFieldId,
  NucleiSeverityPreset,
} from "../types/nuclei.types";

export const nucleiSeverityOptions: NucleiSeverityPreset[] = [
  "all",
  "medium+",
  "high+",
  "critical",
];

export const nucleiSeverityCliValues: Record<
  Exclude<NucleiSeverityPreset, "all">,
  string
> = {
  "medium+": "medium,high,critical",
  "high+": "high,critical",
  critical: "critical",
};

export const nucleiFieldOrder: NucleiFieldId[] = [
  "target",
  "severityPreset",
  "tags",
  "templatesPath",
  "extraArgs",
  "useAuthenticatedContext",
];
