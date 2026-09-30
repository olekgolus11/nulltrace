import { readFileSync } from "node:fs";
import { CurlWorkerConfiguration } from "./curl-worker.types";

export function parseCurlWorkerConfiguration(value: unknown): CurlWorkerConfiguration {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error("Invalid cURL request configuration.");
  const record = value as Record<string, unknown>;
  const keys = ["version", "targetUrl", "exactOrigin", "method", "headers", "bodyOperations", "maximumRedirectCount", "maximumResponseBytes", "timeoutSeconds"];
  if (Object.keys(record).length !== keys.length || keys.some((key) => !(key in record)) || record.version !== 1) {
    throw new Error("Invalid cURL request configuration.");
  }
  if (typeof record.targetUrl !== "string" || Buffer.byteLength(record.targetUrl) > 8192 ||
    typeof record.exactOrigin !== "string" || Buffer.byteLength(record.exactOrigin) > 512 ||
    typeof record.method !== "string" || !["GET", "HEAD", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"].includes(record.method) ||
    !Array.isArray(record.headers) || record.headers.length > 64 || record.headers.some((header) => typeof header !== "string") ||
    !Array.isArray(record.bodyOperations) || record.bodyOperations.length > 64 ||
    record.maximumRedirectCount !== 5 || record.maximumResponseBytes !== 2 * 1024 * 1024 ||
    typeof record.timeoutSeconds !== "number" || !Number.isInteger(record.timeoutSeconds) || record.timeoutSeconds < 1 || record.timeoutSeconds > 30) {
    throw new Error("Invalid cURL request configuration.");
  }
  const target = parseHttpUrl(record.targetUrl);
  const origin = parseHttpUrl(record.exactOrigin);
  if (target.origin !== record.exactOrigin || origin.origin !== record.exactOrigin || origin.pathname !== "/" ||
    target.username || target.password || target.hash) throw new Error("cURL target must match its approved exact origin.");
  for (const header of record.headers as string[]) validateCurlWorkerHeader(header);
  if ((record.headers as string[]).reduce((total, header) => total + Buffer.byteLength(header), 0) > 64 * 1024) {
    throw new Error("cURL request headers exceeded their limit.");
  }
  let bodyBytes = 0;
  for (const operation of record.bodyOperations) {
    if (!operation || typeof operation !== "object" || Array.isArray(operation) ||
      Object.keys(operation).length !== 2 || !["data", "data-raw", "data-binary"].includes(operation.kind) ||
      typeof operation.value !== "string" || operation.value.startsWith("@")) {
      throw new Error("Invalid inline cURL body operation.");
    }
    bodyBytes += Buffer.byteLength(operation.value);
    if (bodyBytes > 256 * 1024) throw new Error("cURL request body exceeded its limit.");
  }
  bodyBytes += Math.max(0, record.bodyOperations.length - 1);
  if (bodyBytes > 256 * 1024) throw new Error("cURL request body exceeded its limit.");
  return record as unknown as CurlWorkerConfiguration;
}

export function quoteCurlConfigValue(value: string): string {
  return `"${value.replaceAll("\\", "\\\\").replaceAll('"', '\\"').replaceAll("\r", "\\r").replaceAll("\n", "\\n")}"`;
}

export function readCurlWorkerFile(path: string, maximumBytes: number): Buffer {
  if (Bun.file(path).size > maximumBytes) throw new Error("cURL response exceeded its size limit.");
  return readFileSync(path);
}

export async function readCurlWorkerStream(
  stream: ReadableStream<Uint8Array>,
  maximumBytes: number,
  onOverflow: () => void,
): Promise<string> {
  const reader = stream.getReader();
  const chunks: Uint8Array[] = [];
  let totalBytes = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      totalBytes += value.byteLength;
      if (totalBytes > maximumBytes) {
        onOverflow();
        await reader.cancel();
        throw new Error("cURL status output exceeded its limit.");
      }
      chunks.push(value);
    }
  } finally {
    reader.releaseLock();
  }
  const combined = new Uint8Array(totalBytes);
  let offset = 0;
  for (const chunk of chunks) { combined.set(chunk, offset); offset += chunk.byteLength; }
  return new TextDecoder().decode(combined);
}

export function readCurlWorkerLocation(headers: string): string | null {
  const block = headers.trim().split(/\r?\n\r?\n/).at(-1) ?? "";
  const line = block.split(/\r?\n/).find((value) => value.toLowerCase().startsWith("location:"));
  return line?.slice(line.indexOf(":") + 1).trim() ?? null;
}

export function redactCurlWorkerHeaders(headers: string, exactOrigin: string): string {
  return headers.split(/\r?\n/).map((line) => {
    const separator = line.indexOf(":");
    if (separator <= 0) return line;
    const name = line.slice(0, separator);
    if (["set-cookie", "authorization", "proxy-authorization", "x-api-key", "x-auth-token"].includes(name.toLowerCase())) return `${name}: [redacted]`;
    if (name.toLowerCase() !== "location") return line;
    try {
      const location = new URL(line.slice(separator + 1).trim(), exactOrigin);
      if (location.origin !== exactOrigin) return `${name}: [cross-origin redacted]`;
      return `${name}: ${location.origin}${location.pathname}${location.search ? "?[redacted]" : ""}${location.hash ? "#[redacted]" : ""}`;
    } catch { return `${name}: [invalid redacted]`; }
  }).join("\n").trim();
}

export function formatCurlWorkerUrl(value: string): string {
  try { const url = new URL(value); return `${url.origin}${url.pathname}${url.search ? "?[redacted]" : ""}${url.hash ? "#[redacted]" : ""}`; }
  catch { return "[invalid URL]"; }
}

function validateCurlWorkerHeader(value: string): void {
  if (/^[\s@]|[\u0000-\u001f\u007f]/.test(value)) throw new Error("cURL headers must be inline text values.");
  const separator = value.indexOf(":");
  const rawName = separator > 0 ? value.slice(0, separator) : "";
  if (!/^[!#$%&'*+.^_`|~0-9A-Za-z-]+$/.test(rawName)) throw new Error("Invalid cURL header name.");
  const name = rawName.toLowerCase();
  if (!name || ["authorization", "cookie", "proxy-authorization", "api-key", "x-api-key", "x-auth-token", "connection", "content-length", "host", "proxy-connection", "transfer-encoding", "upgrade"].includes(name)) {
    throw new Error("Sensitive or transport-level cURL headers are not allowed in the public profile.");
  }
}

function parseHttpUrl(value: string): URL {
  const url = new URL(value);
  if (url.protocol !== "http:" && url.protocol !== "https:") throw new Error("cURL target must use HTTP or HTTPS.");
  return url;
}
