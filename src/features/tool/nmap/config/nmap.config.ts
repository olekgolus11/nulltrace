import { NmapFieldId, NmapTiming } from "../types/nmap.types";

export const nmapTimingOptions: NmapTiming[] = ["T2", "T3", "T4", "T5"];

export const nmapFieldOrder: NmapFieldId[] = [
  "target",
  "ports",
  "timing",
  "serviceDetection",
  "osDetection",
  "defaultScripts",
  "aggressive",
  "extraArgs",
];

export const nmapBooleanFields: NmapFieldId[] = [
  "serviceDetection",
  "osDetection",
  "defaultScripts",
  "aggressive",
];
