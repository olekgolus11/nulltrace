import { splitAuthenticatedHeaderEntries } from "./authenticated-request-context-redaction";

export function validateAuthenticatedRequestHeaders(headers: string) {
  const entries = splitAuthenticatedHeaderEntries(headers);
  const invalidHeader = entries.find((entry) => {
    const separatorIndex = entry.indexOf(":");
    return separatorIndex <= 0 || !entry.slice(separatorIndex + 1).trim();
  });
  if (invalidHeader) {
    throw new Error("Each request header must use the Name: value format.");
  }
}

export function normalizeExactOrigin(value: string) {
  const url = new URL(value);
  if (url.protocol !== "https:" && url.protocol !== "http:") {
    throw new Error("Authentication context requires an HTTP or HTTPS target.");
  }
  return url.origin;
}

export function validateAuthenticatedRequestContextOrigin(
  targetUrl: string,
  contextOrigin: string,
) {
  const targetOrigin = normalizeExactOrigin(targetUrl);
  const normalizedContextOrigin = normalizeExactOrigin(contextOrigin);
  if (targetOrigin !== normalizedContextOrigin) {
    throw new Error("Authentication context must match the session target's exact origin.");
  }
  return targetOrigin;
}
