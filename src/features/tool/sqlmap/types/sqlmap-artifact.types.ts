export type SqlmapVerificationOutcome = "positive" | "negative" | "inconclusive";

export interface SqlmapOutputParseContext {
  endpoint: string;
  method: "GET" | "POST";
  parameter: string;
}

export interface SqlmapTechniqueObservation {
  type: string;
  title: string;
}

export interface SqlmapInjectionObservation extends SqlmapOutputParseContext {
  place: "GET" | "POST";
  databaseManagementSystem: string | null;
  techniques: SqlmapTechniqueObservation[];
}

export interface ParsedSqlmapOutput {
  outcome: SqlmapVerificationOutcome;
  observations: SqlmapInjectionObservation[];
  parseWarning: string | null;
}
