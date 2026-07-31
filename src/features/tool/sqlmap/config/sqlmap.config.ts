import { SqlmapFieldId } from "../types/sqlmap.types";

export const sqlmapFieldOrder: SqlmapFieldId[] = [
  "targetUrl",
  "method",
  "parameter",
  "body",
  "level",
  "risk",
  "timeLimitSeconds",
  "extraSafeOptions",
];

export const sqlmapDefaultTimeLimitSeconds = 300;
export const sqlmapMinimumTimeLimitSeconds = 30;
export const sqlmapMaximumTimeLimitSeconds = 900;
