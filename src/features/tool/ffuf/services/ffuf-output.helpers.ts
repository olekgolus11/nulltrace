import {
  FfufArtifactResult,
  FfufParameterCandidate,
  FfufParameterDiscoveryFormState,
  FfufSitemapMatch,
  FfufValueFuzzingFormState,
  FfufValueFuzzingResult,
  ParsedFfufOutput,
} from "../types/ffuf.types";

const maximumPayloadLength = 256;
const sensitivePayloadPattern =
  /(?:authorization|cookie|token|secret|password|passwd|api[_-]?key)\s*[:=]\s*\S+/gi;
const injectionPayloadPattern =
  /(?:['"`]\s*(?:or|and)\b|(?:union|select|sleep|benchmark)\b|<script\b|javascript:|\.\.[/\\]|%2e%2e|\/etc\/passwd|\$\{|\{\{)/i;

interface FfufRawResult {
  [key: string]: unknown;
}

interface FfufRawOutput {
  results?: unknown;
}

export function parseFfufOutput(content: string): ParsedFfufOutput {
  try {
    const output = JSON.parse(content) as FfufRawOutput;
    if (!Array.isArray(output.results)) {
      return {
        results: [],
        parseErrorCount: 1,
      };
    }

    return output.results.reduce<ParsedFfufOutput>(
      (parsed, rawResult) => {
        const result = readFfufArtifactResult(rawResult);
        if (!result) {
          return {
            ...parsed,
            parseErrorCount: parsed.parseErrorCount + 1,
          };
        }

        parsed.results.push(result);
        return parsed;
      },
      { results: [], parseErrorCount: 0 },
    );
  } catch {
    return {
      results: [],
      parseErrorCount: 1,
    };
  }
}

export function selectExactOriginFfufMatches(
  results: FfufArtifactResult[],
  targetUrl: string,
): FfufSitemapMatch[] {
  let targetOrigin: string;
  try {
    targetOrigin = new URL(targetUrl).origin;
  } catch {
    return [];
  }

  const matchedUrls = new Set<string>();
  return results.reduce<FfufSitemapMatch[]>((matches, result) => {
    if (typeof result.url !== "string" || typeof result.status !== "number") {
      return matches;
    }
    if (!Number.isInteger(result.status)) {
      return matches;
    }

    try {
      const url = new URL(result.url);
      if (url.origin !== targetOrigin) {
        return matches;
      }

      url.hash = "";
      const normalizedUrl = url.toString();
      if (matchedUrls.has(normalizedUrl)) {
        return matches;
      }

      matchedUrls.add(normalizedUrl);
      matches.push({
        normalizedUrl,
        path: `${url.pathname}${url.search}` || "/",
        httpStatus: result.status,
        depth: getFfufPathDepth(url.pathname),
      });
    } catch {
      return matches;
    }

    return matches;
  }, []);
}

export function mapFfufParameterCandidates(
  results: FfufArtifactResult[],
  form: FfufParameterDiscoveryFormState,
  toolRunId: string,
  maximumCandidateCount: number,
): FfufParameterCandidate[] {
  const candidateNames = new Set<string>();

  return results.reduce<FfufParameterCandidate[]>((candidates, result) => {
    if (candidates.length >= maximumCandidateCount) return candidates;

    const parameterName = result.input.FUZZ?.trim();
    if (!parameterName || candidateNames.has(parameterName)) return candidates;

    candidateNames.add(parameterName);
    candidates.push({
      parameterName,
      requestLocation: form.requestLocation,
      response: {
        status: result.status,
        size: result.length,
        signature: {
          words: result.words,
          lines: result.lines,
        },
      },
      provenance: {
        toolRunId,
        endpoint: form.endpoint,
        mode: "parameter_discovery",
      },
    });
    return candidates;
  }, []);
}

export function mapFfufValueFuzzingResults(
  results: FfufArtifactResult[],
  form: FfufValueFuzzingFormState,
  toolRunId: string,
  maximumResultCount: number,
): FfufValueFuzzingResult[] {
  return results.slice(0, maximumResultCount).flatMap((result) => {
    const rawPayload = result.input.FUZZ;
    if (typeof rawPayload !== "string") return [];
    const decodedPayload = decodeFfufPayload(rawPayload);
    const payload = redactFfufPayload(decodedPayload);
    const anomaly = classifyFfufValueAnomaly(result, decodedPayload, form.endpoint);

    return [{
      payload,
      requestLocation: form.requestLocation,
      parameterName: form.parameterName,
      response: {
        status: result.status,
        size: result.length,
        words: result.words,
        lines: result.lines,
        redirectLocation: redactRedirectLocation(result.redirectLocation, form.endpoint),
      },
      anomaly,
      provenance: {
        toolRunId,
        endpoint: stripUrlQuery(form.endpoint),
        mode: "value_fuzzing",
      },
    }];
  });
}

export function classifyFfufValueAnomaly(
  result: FfufArtifactResult,
  payload: string,
  endpoint: string,
): FfufValueFuzzingResult["anomaly"] {
  if (result.status >= 500 && result.status <= 599 && injectionPayloadPattern.test(payload)) {
    return { kind: "server_error", severity: "medium" };
  }
  if (
    result.status >= 300 &&
    result.status <= 399 &&
    result.redirectLocation &&
    isExternalRedirectMatch(result.redirectLocation, payload, endpoint)
  ) {
    return { kind: "external_redirect", severity: "medium" };
  }
  return null;
}

export function redactFfufPayload(payload: string) {
  const bounded = payload.slice(0, maximumPayloadLength);
  const redacted = bounded.replace(sensitivePayloadPattern, (match) => {
    const separatorIndex = Math.max(match.indexOf(":"), match.indexOf("="));
    return `${match.slice(0, separatorIndex + 1)}[REDACTED]`;
  });
  return payload.length > maximumPayloadLength ? `${redacted}…` : redacted;
}

function isExternalRedirectMatch(location: string, payload: string, endpoint: string) {
  try {
    const redirect = new URL(location, endpoint);
    const targetOrigin = new URL(endpoint).origin;
    const payloadUrl = new URL(payload);
    return redirect.origin !== targetOrigin && redirect.origin === payloadUrl.origin;
  } catch {
    return false;
  }
}

function redactRedirectLocation(location: string | null, endpoint: string) {
  if (!location) return null;
  try {
    const url = new URL(location, endpoint);
    return `${url.origin}${url.pathname.slice(0, 160)}`;
  } catch {
    return location.slice(0, 160);
  }
}

function stripUrlQuery(value: string) {
  try {
    const url = new URL(value);
    url.search = "";
    url.hash = "";
    return url.toString();
  } catch {
    return value.split(/[?#]/, 1)[0] ?? value;
  }
}

function decodeFfufPayload(value: string) {
  try {
    return decodeURIComponent(value.replace(/\+/g, " "));
  } catch {
    return value;
  }
}

export function readFfufArtifactResult(value: unknown): FfufArtifactResult | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return null;
  }

  const result = value as FfufRawResult;
  const url = getNonBlankString(result.url);
  const status = getFiniteNumber(result.status);
  if (!url || status === null || !Number.isInteger(status)) {
    return null;
  }

  return {
    url,
    status,
    input: getFfufInput(result.input),
    length: getFiniteNumber(result.length),
    words: getFiniteNumber(result.words),
    lines: getFiniteNumber(result.lines),
    redirectLocation: getNonBlankString(result.redirectlocation),
    position: getFiniteNumber(result.position),
  };
}

function getNonBlankString(value: unknown): string | null {
  return typeof value === "string" && value.trim() ? value : null;
}

function getFiniteNumber(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function getFfufInput(value: unknown): Record<string, string> {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return {};
  }

  return Object.entries(value).reduce<Record<string, string>>((result, [key, item]) => {
    if (typeof item === "string") {
      result[key] = item;
    }
    return result;
  }, {});
}

function getFfufPathDepth(pathname: string) {
  return pathname.split("/").filter(Boolean).length;
}
