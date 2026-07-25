import { FfufFieldId } from "../types/ffuf.types";

export const ffufFieldOrder = [
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
