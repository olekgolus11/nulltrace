import { FfufFieldId, FfufMode } from "../types/ffuf.types";

const contentDiscoveryFieldOrder = [
  "mode",
  "targetPattern",
  "wordlist",
  "extensions",
  "recursion",
  "recursionDepth",
  "matchCodes",
  "filterCodes",
  "rate",
  "timeLimit",
] as const satisfies readonly FfufFieldId[];

const parameterDiscoveryFieldOrder = [
  "mode",
  "endpoint",
  "requestLocation",
  "wordlist",
  "matchCodes",
  "filterCodes",
  "rate",
  "timeLimit",
] as const satisfies readonly FfufFieldId[];

export function getFfufFieldOrder(mode: FfufMode): readonly FfufFieldId[] {
  return mode === "parameter_discovery" ? parameterDiscoveryFieldOrder : contentDiscoveryFieldOrder;
}
