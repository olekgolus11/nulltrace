import {
  AuthCheckMetadata,
  AuthenticatedRequestContext,
  AuthenticatedRequestContextMetadata,
  RedactedAuthenticatedRequestContextPreview,
} from "../model/authenticated-request-context.types";

export function createUncheckedAuthCheckMetadata(): AuthCheckMetadata {
  return {
    status: "not_checked",
    verificationUrl: null,
    checkedAt: null,
    acknowledgedAt: null,
    isProceedAllowed: false,
    summary: "Authentication context has not been checked.",
    signals: null,
  };
}

export function splitAuthenticatedCookieEntries(value: string) {
  return value
    .split(/[;\n\r]+/)
    .map((entry) => entry.trim())
    .filter(Boolean);
}

export function splitAuthenticatedHeaderEntries(value: string): string[] {
  return value
    .split(/[\n\r|]+/)
    .map((entry) => entry.trim())
    .filter(Boolean);
}

export function getAuthenticatedHeaderNames(value: string) {
  return splitAuthenticatedHeaderEntries(value).map((entry) => {
    const separatorIndex = entry.indexOf(":");
    return separatorIndex === -1 ? entry : entry.slice(0, separatorIndex).trim();
  });
}

export function createRedactedAuthenticatedRequestContextPreview(input: {
  origin: string;
  cookies: string;
  headers: string;
}): RedactedAuthenticatedRequestContextPreview {
  const cookieCount = splitAuthenticatedCookieEntries(input.cookies).length;
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
    importSource: context.importSource ?? "manual",
    updatedAt: context.updatedAt,
    authCheck: createUncheckedAuthCheckMetadata(),
  };
}
