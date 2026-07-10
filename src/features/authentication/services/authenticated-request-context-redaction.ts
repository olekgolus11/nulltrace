import {
  AuthenticatedRequestContext,
  AuthenticatedRequestContextMetadata,
  RedactedAuthenticatedRequestContextPreview,
} from "../model/authenticated-request-context.types";

function splitCookieEntries(value: string) {
  return value
    .split(/[;\n\r]+/)
    .map((entry) => entry.trim())
    .filter(Boolean);
}

function splitHeaderEntries(value: string) {
  return value
    .split(/[\n\r|]+/)
    .map((entry) => entry.trim())
    .filter(Boolean);
}

export function getAuthenticatedHeaderNames(value: string) {
  return splitHeaderEntries(value).map((entry) => {
    const separatorIndex = entry.indexOf(":");
    return separatorIndex === -1 ? entry : entry.slice(0, separatorIndex).trim();
  });
}

export function createRedactedAuthenticatedRequestContextPreview(input: {
  origin: string;
  cookies: string;
  headers: string;
}): RedactedAuthenticatedRequestContextPreview {
  const cookieCount = splitCookieEntries(input.cookies).length;
  const headerNames = getAuthenticatedHeaderNames(input.headers);

  return {
    origin: input.origin,
    cookieCount,
    headerNames,
    cookiePreview:
      cookieCount === 0
        ? "No cookies"
        : `${cookieCount} cookie${cookieCount === 1 ? "" : "s"} [redacted]`,
    headerPreview: headerNames.map((name) => `${name}: [redacted]`),
  };
}

export function createAuthenticatedRequestContextMetadata(
  context: AuthenticatedRequestContext,
  storageMode: AuthenticatedRequestContextMetadata["storageMode"],
): AuthenticatedRequestContextMetadata {
  const preview = createRedactedAuthenticatedRequestContextPreview(context);

  return {
    origin: context.origin,
    cookieCount: preview.cookieCount,
    headerNames: preview.headerNames,
    storageMode,
    updatedAt: context.updatedAt,
  };
}
