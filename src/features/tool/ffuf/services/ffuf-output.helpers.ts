import { FfufArtifactResult, FfufSitemapMatch, ParsedFfufOutput } from "../types/ffuf.types";

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
