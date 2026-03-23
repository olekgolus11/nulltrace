export type NmapTiming = "T2" | "T3" | "T4" | "T5";

export type NmapFieldId =
  | "target"
  | "ports"
  | "timing"
  | "serviceDetection"
  | "osDetection"
  | "defaultScripts"
  | "aggressive"
  | "extraArgs";

export interface NmapFormState {
  target: string;
  ports: string;
  timing: NmapTiming;
  serviceDetection: boolean;
  osDetection: boolean;
  defaultScripts: boolean;
  aggressive: boolean;
  extraArgs: string;
}

export interface NmapToolData {
  form: NmapFormState;
  selectedField: number;
}
