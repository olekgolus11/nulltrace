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
  "isAuthenticatedContextEnabled",
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
  "isAuthenticatedContextEnabled",
] as const satisfies readonly FfufFieldId[];

const valueFuzzingFieldOrder = [
  "mode",
  "endpoint",
  "parameterName",
  "requestLocation",
  "wordlist",
  "matchCodes",
  "filterCodes",
  "rate",
  "timeLimit",
  "isAuthenticatedContextEnabled",
] as const satisfies readonly FfufFieldId[];

export function getFfufFieldOrder(mode: FfufMode): readonly FfufFieldId[] {
  if (mode === "parameter_discovery") return parameterDiscoveryFieldOrder;
  if (mode === "value_fuzzing") return valueFuzzingFieldOrder;
  return contentDiscoveryFieldOrder;
}
