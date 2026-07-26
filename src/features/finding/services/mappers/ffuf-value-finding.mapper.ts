import { FindingCandidate, FindingMapper } from "../../model/finding.types";
import { ToolRunArtifactRecord } from "../../../session/model/session.repository.types";

interface FfufValueArtifactPayload {
  results?: unknown[];
}

interface FfufValueResult {
  payload: string;
  requestLocation: string;
  parameterName: string;
  response: {
    status: number;
    size: number | null;
    words: number | null;
    lines: number | null;
    redirectLocation: string | null;
  };
  anomaly: {
    kind: "server_error" | "external_redirect";
    severity: "medium";
  };
  provenance: {
    endpoint: string;
  };
}

export const ffufValueFindingMapper: FindingMapper = {
  artifactType: "ffuf_value_fuzzing",
  mapArtifact(artifact: ToolRunArtifactRecord) {
    if (!isRecord(artifact.payload)) return [];
    const payload = artifact.payload as FfufValueArtifactPayload;
    if (!Array.isArray(payload.results)) return [];

    return payload.results.flatMap((value, index) => {
      const result = readAnomalousResult(value);
      return result ? [createFinding(result, index)] : [];
    });
  },
};

function createFinding(result: FfufValueResult, index: number): FindingCandidate {
  const label =
    result.anomaly.kind === "external_redirect"
      ? "External redirect"
      : "Server error from injection-style payload";
  return {
    sourceTool: "ffuf",
    kind: `ffuf.value.${result.anomaly.kind}`,
    severity: result.anomaly.severity,
    title: `${label} in ${result.parameterName}`,
    summary:
      `FFUF observed ${label.toLowerCase()} while fuzzing ${result.requestLocation} ` +
      `parameter ${result.parameterName}. Operator review required.`,
    target: result.provenance.endpoint,
    dedupeKeyParts: [
      result.provenance.endpoint,
      result.requestLocation,
      result.parameterName,
      result.anomaly.kind,
    ],
    payload: {
      artifactResultIndex: index,
      artifactItemPath: `$.results[${index}]`,
      parameterName: result.parameterName,
      requestLocation: result.requestLocation,
      testedPayload: result.payload,
      anomalyKind: result.anomaly.kind,
      responseStatus: result.response.status,
      responseSize: result.response.size,
      responseWords: result.response.words,
      responseLines: result.response.lines,
      redirectLocation: result.response.redirectLocation,
    },
  };
}

function readAnomalousResult(value: unknown): FfufValueResult | null {
  if (!isRecord(value) || !isRecord(value.response) || !isRecord(value.anomaly)) return null;
  if (!isRecord(value.provenance)) return null;
  if (
    typeof value.payload !== "string" ||
    !isFfufRequestLocation(value.requestLocation) ||
    typeof value.parameterName !== "string" ||
    typeof value.response.status !== "number" ||
    typeof value.provenance.endpoint !== "string" ||
    !isNullableNumber(value.response.size) ||
    !isNullableNumber(value.response.words) ||
    !isNullableNumber(value.response.lines) ||
    !isNullableString(value.response.redirectLocation)
  ) {
    return null;
  }
  const kind = value.anomaly.kind;
  if (
    (kind !== "server_error" && kind !== "external_redirect") ||
    value.anomaly.severity !== "medium"
  ) {
    return null;
  }
  return value as unknown as FfufValueResult;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function isFfufRequestLocation(value: unknown) {
  return value === "query" || value === "body" || value === "header";
}

function isNullableNumber(value: unknown) {
  return value === null || (typeof value === "number" && Number.isFinite(value));
}

function isNullableString(value: unknown) {
  return value === null || typeof value === "string";
}
