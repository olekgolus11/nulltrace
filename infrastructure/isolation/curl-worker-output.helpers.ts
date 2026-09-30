import { CurlWorkerConfiguration } from "./curl-worker.types";
import { formatCurlWorkerUrl, redactCurlWorkerHeaders } from "./curl-worker.helpers";

export const curlWorkerOutputLimits = {
  maximumTranscriptBytes: 384 * 1024,
  maximumBodyBytes: 256 * 1024,
  maximumHeaderBytes: 64 * 1024,
  maximumDiagnosticBytes: 8 * 1024,
  maximumLineBytes: 3_500,
  maximumBodyLines: 1_760,
  maximumHeaderLines: 160,
  maximumDiagnosticLines: 32,
  maximumFooterLines: 8,
} as const;

export function redactCurlWorkerOutput(
  value: string,
  config: CurlWorkerConfiguration,
  previousQueryValues: readonly string[] = [],
): string {
  const result = redactCurlWorkerOutputBounded(value, config, previousQueryValues, curlWorkerOutputLimits.maximumTranscriptBytes);
  return `${result.value}${result.truncated ? "[redaction output truncated]" : ""}`;
}

export function formatCurlWorkerResponse(
  headers: string,
  body: string,
  statusText: string,
  elapsed: string,
  targetUrl: string,
  config: CurlWorkerConfiguration,
  previousQueryValues: readonly string[] = [],
): string[] {
  const lines: string[] = [];
  const safeHeaders = redactCurlWorkerHeaders(headers, config.exactOrigin);
  lines.push(...formatCurlWorkerSection(safeHeaders, config, previousQueryValues, {
    maximumBytes: curlWorkerOutputLimits.maximumHeaderBytes,
    maximumLines: curlWorkerOutputLimits.maximumHeaderLines,
    label: "response headers",
  }));
  lines.push(...formatCurlWorkerSection(body, config, previousQueryValues, {
    maximumBytes: curlWorkerOutputLimits.maximumBodyBytes,
    maximumLines: curlWorkerOutputLimits.maximumBodyLines,
    label: "response body",
  }));
  const status = /^\d{3}$/.test(statusText) ? statusText : "000";
  const safeElapsed = /^\d+(?:\.\d+)?$/.test(elapsed) && Number.isFinite(Number(elapsed))
    ? elapsed
    : "0";
  const formattedUrl = formatCurlWorkerUrl(targetUrl);
  const safeUrl = redactCurlWorkerOutputBounded(
    formattedUrl,
    config,
    previousQueryValues,
    curlWorkerOutputLimits.maximumLineBytes * (curlWorkerOutputLimits.maximumFooterLines - 1),
  );
  const footerUrl = `${sanitizeCurlWorkerText(safeUrl.value)}${safeUrl.truncated ? " [URL truncated]" : ""}`;
  const footer = sanitizeCurlWorkerText(`[http ${status}] ${safeElapsed}s ${footerUrl}`);
  lines.push(...splitCurlWorkerLines(footer, curlWorkerOutputLimits.maximumLineBytes).slice(0, curlWorkerOutputLimits.maximumFooterLines));
  return lines;
}

export function parseCurlWorkerWriteout(value: string): [string, string] {
  const match = /^(\d{3})\t(\d+(?:\.\d+)?)$/.exec(value);
  if (!match || !Number.isFinite(Number(match[2]))) return ["000", "0"];
  return [match[1]!, match[2]!];
}

export function formatCurlWorkerDiagnostics(
  value: string,
  config: CurlWorkerConfiguration,
  previousQueryValues: readonly string[] = [],
): string[] {
  return formatCurlWorkerSection(value, config, previousQueryValues, {
    maximumBytes: curlWorkerOutputLimits.maximumDiagnosticBytes,
    maximumLines: curlWorkerOutputLimits.maximumDiagnosticLines,
    label: "diagnostics",
  });
}

function formatCurlWorkerSection(
  value: string,
  config: CurlWorkerConfiguration,
  previousQueryValues: readonly string[],
  options: { maximumBytes: number; maximumLines: number; label: string },
): string[] {
  if (!value) return [];
  const redacted = redactCurlWorkerOutputBounded(value, config, previousQueryValues, options.maximumBytes);
  const sanitized = sanitizeCurlWorkerText(redacted.value);
  const chunks = splitCurlWorkerLines(sanitized, curlWorkerOutputLimits.maximumLineBytes);
  const bounded = chunks.slice(0, options.maximumLines);
  if (redacted.truncated || chunks.length > options.maximumLines) {
    bounded.push(`[${options.label} truncated by output limit]`);
  }
  return bounded;
}

function redactCurlWorkerOutputBounded(
  value: string,
  config: CurlWorkerConfiguration,
  previousQueryValues: readonly string[],
  maximumBytes: number,
): { value: string; truncated: boolean } {
  const sensitiveValues = getCurlWorkerSensitiveValues(config, previousQueryValues);
  const parts: string[] = [];
  let outputBytes = 0;
  let offset = 0;
  while (offset < value.length) {
    let match: string | null = null;
    for (const candidate of sensitiveValues) {
      if (candidate.length > (match?.length ?? 0) && value.startsWith(candidate, offset)) match = candidate;
    }
    const codePoint = match ?? String.fromCodePoint(value.codePointAt(offset)!);
    const output = match ? "[redacted]" : codePoint;
    const bytes = Buffer.byteLength(output);
    if (outputBytes + bytes > maximumBytes) return { value: parts.join(""), truncated: true };
    parts.push(output);
    outputBytes += bytes;
    offset += match?.length ?? codePoint.length;
  }
  return { value: parts.join(""), truncated: false };
}

function getCurlWorkerSensitiveValues(config: CurlWorkerConfiguration, previousQueryValues: readonly string[]): string[] {
  const values = [
    ...config.bodyOperations.map((operation) => operation.value),
    ...config.headers.map((header) => header.slice(header.indexOf(":") + 1).trim()),
    ...previousQueryValues,
  ].filter(Boolean);
  try {
    const url = new URL(config.targetUrl);
    if (url.search) values.push(url.search);
    values.push(...url.searchParams.values(), ...readRawQueryValues(url.search));
  } catch { /* The URL was validated before execution. */ }
  return [...new Set(values)].sort((left, right) => right.length - left.length);
}

function readRawQueryValues(search: string): string[] {
  return search.slice(1).split("&").map((part) => part.slice(part.indexOf("=") + 1)).filter(Boolean);
}

function sanitizeCurlWorkerText(value: string): string {
  let output = "";
  let state: "text" | "escape" | "csi" | "osc" | "osc_escape" = "text";
  for (const character of value) {
    if (state === "escape") {
      state = character === "[" ? "csi" : character === "]" ? "osc" : "text";
      continue;
    }
    if (state === "csi") {
      const code = character.codePointAt(0)!;
      if (code >= 0x40 && code <= 0x7e) state = "text";
      continue;
    }
    if (state === "osc") {
      if (character === "\u0007") state = "text";
      if (character === "\u001b") state = "osc_escape";
      continue;
    }
    if (state === "osc_escape") {
      state = character === "\\" ? "text" : "osc";
      continue;
    }
    if (character === "\u001b") {
      state = "escape";
      continue;
    }
    if (character === "\r") continue;
    const code = character.codePointAt(0)!;
    if ((code < 32 && character !== "\n" && character !== "\t") || (code >= 127 && code <= 159) ||
      (code >= 0x202a && code <= 0x202e) || (code >= 0x2066 && code <= 0x2069)) continue;
    output += character === "\t" ? " " : character;
  }
  return output;
}

function splitCurlWorkerLines(value: string, maximumBytes: number): string[] {
  const lines: string[] = [];
  let line = "";
  let bytes = 0;
  for (const character of value) {
    if (character === "\n") {
      lines.push(line);
      line = "";
      bytes = 0;
      continue;
    }
    const size = Buffer.byteLength(character);
    if (bytes + size > maximumBytes) {
      lines.push(line);
      line = "";
      bytes = 0;
    }
    line += character;
    bytes += size;
  }
  if (line || !lines.length || value.endsWith("\n")) lines.push(line);
  return lines;
}
