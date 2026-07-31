import { ToolRunArtifactRecord } from "../../../session/model/session.repository.types";
import { FindingCandidate, FindingMapper } from "../../model/finding.types";

export const sqlmapFindingMapper: FindingMapper = {
  artifactType: "sqlmap_verification",
  mapArtifact(artifact: ToolRunArtifactRecord) {
    if (
      !isRecord(artifact.payload) ||
      artifact.payload.outcome !== "positive" ||
      !Array.isArray(artifact.payload.observations)
    ) {
      return [];
    }

    return artifact.payload.observations.flatMap((value, index) => {
      const observation = readObservation(value);
      return observation ? [createFinding(observation, index)] : [];
    });
  },
};

interface SqlmapFindingObservation {
  endpoint: string;
  method: "GET" | "POST";
  parameter: string;
  databaseManagementSystem: string | null;
  techniqueTypes: string[];
}

function createFinding(
  observation: SqlmapFindingObservation,
  index: number,
): FindingCandidate {
  const techniqueSummary = observation.techniqueTypes.join(", ");
  const databaseSummary = observation.databaseManagementSystem
    ? ` Backend DBMS: ${observation.databaseManagementSystem}.`
    : "";
  return {
    sourceTool: "sqlmap",
    kind: "sqlmap.sql_injection",
    severity: "high",
    title: `SQL injection verified in ${observation.parameter}`,
    summary:
      `sqlmap observed ${techniqueSummary} SQL injection behavior in ${observation.method} ` +
      `parameter ${observation.parameter}.${databaseSummary} Operator review required.`,
    target: observation.endpoint,
    dedupeKeyParts: [
      observation.endpoint,
      observation.method,
      observation.parameter,
    ],
    payload: {
      artifactObservationIndex: index,
      artifactItemPath: `$.observations[${index}]`,
      method: observation.method,
      parameter: observation.parameter,
      databaseManagementSystem: observation.databaseManagementSystem,
      techniqueTypes: observation.techniqueTypes,
    },
  };
}

function readObservation(value: unknown): SqlmapFindingObservation | null {
  if (!isRecord(value)) return null;
  const endpoint = text(value.endpoint);
  const parameter = text(value.parameter);
  const method = value.method;
  if (!endpoint || !parameter || (method !== "GET" && method !== "POST")) return null;
  if (!Array.isArray(value.techniques)) return null;
  const techniqueTypes = value.techniques.flatMap((technique) => {
    if (!isRecord(technique)) return [];
    const type = text(technique.type);
    const title = text(technique.title);
    return type && title ? [type] : [];
  });
  if (techniqueTypes.length === 0) return null;

  return {
    endpoint,
    method,
    parameter,
    databaseManagementSystem: text(value.databaseManagementSystem),
    techniqueTypes,
  };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function text(value: unknown) {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}
