import type { AuthCheckWorkerConfiguration, AuthCheckWorkerLegSignals, AuthCheckWorkerResult } from "./auth-check-worker.types";

const forbiddenHeaders = new Set([
  "connection", "content-length", "host", "proxy-authorization", "proxy-connection",
  "transfer-encoding", "upgrade",
]);

export function parseAuthCheckWorkerConfiguration(value: unknown): AuthCheckWorkerConfiguration {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error("Invalid Auth Check worker configuration.");
  const record = value as Record<string, unknown>;
  const keys = [
    "version", "operation", "contextVersion", "targetOrigin", "verificationUrl", "authenticatedHeaders",
    "requestTimeoutMs", "maximumResponseBytes", "maximumRedirectCount", "totalDeadlineMs",
  ];
  if (Object.keys(record).length !== keys.length || keys.some((key) => !(key in record)) ||
      record.version !== 1 || record.operation !== "auth-check") throw new Error("Invalid Auth Check worker configuration.");
  if (typeof record.targetOrigin !== "string" || Buffer.byteLength(record.targetOrigin) > 512 ||
      typeof record.contextVersion !== "number" || !Number.isSafeInteger(record.contextVersion) || record.contextVersion < 0 ||
      typeof record.verificationUrl !== "string" || Buffer.byteLength(record.verificationUrl) > 8_192 ||
      record.requestTimeoutMs !== 10_000 || record.maximumResponseBytes !== 128_000 ||
      record.maximumRedirectCount !== 5 || typeof record.totalDeadlineMs !== "number" ||
      !Number.isInteger(record.totalDeadlineMs) || record.totalDeadlineMs < 1_000 || record.totalDeadlineMs > 60_000 ||
      !Array.isArray(record.authenticatedHeaders) || record.authenticatedHeaders.length > 64 ||
      record.authenticatedHeaders.some((header) => typeof header !== "string")) {
    throw new Error("Auth Check worker limits are invalid.");
  }
  const origin = parseHttpUrl(record.targetOrigin);
  const target = parseHttpUrl(record.verificationUrl);
  if (origin.origin !== record.targetOrigin || origin.pathname !== "/" || origin.search || origin.hash ||
      target.origin !== origin.origin || target.username || target.password || target.hash) {
    throw new Error("Auth Check URL must match its exact approved origin.");
  }
  let headerBytes = 0;
  for (const header of record.authenticatedHeaders as string[]) {
    if (Buffer.byteLength(header) > 8_192 || /[\u0000-\u001f\u007f-\u009f]/.test(header)) {
      throw new Error("Auth Check private header is invalid.");
    }
    const separator = header.indexOf(":");
    const name = separator > 0 ? header.slice(0, separator).trim() : "";
    if (!/^[!#$%&'*+.^_`|~0-9A-Za-z-]+$/.test(name) || forbiddenHeaders.has(name.toLowerCase())) {
      throw new Error("Auth Check private header is invalid.");
    }
    headerBytes += Buffer.byteLength(header);
  }
  if (headerBytes > 64 * 1024) throw new Error("Auth Check private headers exceeded their limit.");
  return {
    version: 1,
    operation: "auth-check",
    contextVersion: record.contextVersion,
    targetOrigin: record.targetOrigin,
    verificationUrl: record.verificationUrl,
    authenticatedHeaders: [...record.authenticatedHeaders] as string[],
    requestTimeoutMs: 10_000,
    maximumResponseBytes: 128_000,
    maximumRedirectCount: 5,
    totalDeadlineMs: record.totalDeadlineMs,
  };
}

function parseHttpUrl(value: string): URL {
  const url = new URL(value);
  if (url.protocol !== "http:" && url.protocol !== "https:") throw new Error("Auth Check requires HTTP or HTTPS.");
  return url;
}

export function parseAuthCheckWorkerResult(value: unknown): AuthCheckWorkerResult {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error("Invalid Auth Check worker result.");
  const result = value as Record<string, unknown>;
  const keys = ["version", "operation", "status", "isProceedAllowed", "unauthenticated", "authenticated", "differences"];
  if (Object.keys(result).length !== keys.length || keys.some((key) => !(key in result)) || result.version !== 1 ||
      result.operation !== "auth-check" || !["verified", "inconclusive", "failed"].includes(String(result.status)) ||
      typeof result.isProceedAllowed !== "boolean" || result.isProceedAllowed !== (result.status === "verified")) {
    throw new Error("Invalid Auth Check worker result.");
  }
  validatePublicLeg(result.unauthenticated);
  validatePublicLeg(result.authenticated);
  const differences = result.differences;
  const differenceKeys = ["statusChanged", "redirectsChanged", "contentKindChanged", "contentChanged", "titleChanged", "loginFormChanged"];
  if (!differences || typeof differences !== "object" || Array.isArray(differences) ||
      Object.keys(differences).length !== differenceKeys.length ||
      differenceKeys.some((key) => typeof (differences as Record<string, unknown>)[key] !== "boolean")) {
    throw new Error("Invalid Auth Check worker result.");
  }
  validateComparisonSemantics(result);
  return {
    version: 1,
    operation: "auth-check",
    status: result.status as AuthCheckWorkerResult["status"],
    isProceedAllowed: result.isProceedAllowed,
    unauthenticated: copyPublicLeg(result.unauthenticated as AuthCheckWorkerLegSignals),
    authenticated: copyPublicLeg(result.authenticated as AuthCheckWorkerLegSignals),
    differences: {
      statusChanged: (differences as AuthCheckWorkerResult["differences"]).statusChanged,
      redirectsChanged: (differences as AuthCheckWorkerResult["differences"]).redirectsChanged,
      contentKindChanged: (differences as AuthCheckWorkerResult["differences"]).contentKindChanged,
      contentChanged: (differences as AuthCheckWorkerResult["differences"]).contentChanged,
      titleChanged: (differences as AuthCheckWorkerResult["differences"]).titleChanged,
      loginFormChanged: (differences as AuthCheckWorkerResult["differences"]).loginFormChanged,
    },
  };
}

function copyPublicLeg(leg: AuthCheckWorkerLegSignals): AuthCheckWorkerLegSignals {
  return {
    status: leg.status,
    redirectCount: leg.redirectCount,
    hasCrossOriginRedirect: leg.hasCrossOriginRedirect,
    contentKind: leg.contentKind,
    hasLoginForm: leg.hasLoginForm,
  };
}

function validatePublicLeg(value: unknown): asserts value is AuthCheckWorkerLegSignals {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error("Invalid Auth Check worker result.");
  const leg = value as Record<string, unknown>;
  const keys = ["status", "redirectCount", "hasCrossOriginRedirect", "contentKind", "hasLoginForm"];
  if (Object.keys(leg).length !== keys.length || keys.some((key) => !(key in leg)) ||
      typeof leg.status !== "number" || !Number.isInteger(leg.status) || leg.status < 100 || leg.status > 599 ||
      typeof leg.redirectCount !== "number" || !Number.isInteger(leg.redirectCount) || leg.redirectCount < 0 || leg.redirectCount > 6 ||
      typeof leg.hasCrossOriginRedirect !== "boolean" || typeof leg.hasLoginForm !== "boolean" ||
      !["html", "xhtml", "json", "other"].includes(String(leg.contentKind))) {
    throw new Error("Invalid Auth Check worker result.");
  }
  const hasHtmlContent = leg.contentKind === "html" || leg.contentKind === "xhtml";
  if ((leg.hasCrossOriginRedirect && leg.redirectCount < 1) ||
      (leg.redirectCount > 5 && !leg.hasCrossOriginRedirect) || (leg.hasLoginForm && !hasHtmlContent)) {
    throw new Error("Invalid Auth Check worker result.");
  }
}

function validateComparisonSemantics(result: Record<string, unknown>): void {
  const unauthenticated = result.unauthenticated as AuthCheckWorkerLegSignals;
  const authenticated = result.authenticated as AuthCheckWorkerLegSignals;
  const differences = result.differences as AuthCheckWorkerResult["differences"];
  const hasHtmlTitleInEitherLeg = [unauthenticated.contentKind, authenticated.contentKind]
    .some((contentKind) => contentKind === "html" || contentKind === "xhtml");
  if (differences.statusChanged !== (unauthenticated.status !== authenticated.status) ||
      differences.loginFormChanged !== (unauthenticated.hasLoginForm !== authenticated.hasLoginForm) ||
      (!differences.redirectsChanged && (unauthenticated.redirectCount !== authenticated.redirectCount ||
        unauthenticated.hasCrossOriginRedirect !== authenticated.hasCrossOriginRedirect)) ||
      (differences.redirectsChanged && unauthenticated.redirectCount === 0 && authenticated.redirectCount === 0 &&
        !unauthenticated.hasCrossOriginRedirect && !authenticated.hasCrossOriginRedirect) ||
      (differences.titleChanged && !hasHtmlTitleInEitherLeg) ||
      (unauthenticated.hasCrossOriginRedirect && authenticated.hasCrossOriginRedirect && differences.contentChanged) ||
      (!differences.contentKindChanged && unauthenticated.contentKind !== authenticated.contentKind)) {
    throw new Error("Invalid Auth Check worker result.");
  }
  const statusImproved = (unauthenticated.status === 401 || unauthenticated.status === 403) &&
    authenticated.status >= 200 && authenticated.status < 300;
  const loginFormRemoved = unauthenticated.hasLoginForm && !authenticated.hasLoginForm;
  const failed = authenticated.status >= 400 || authenticated.hasCrossOriginRedirect ||
    (authenticated.hasLoginForm && !loginFormRemoved);
  const evidenceScore = (statusImproved ? 3 : 0) + (loginFormRemoved ? 3 : 0) +
    (differences.redirectsChanged ? 2 : 0) + (differences.titleChanged ? 2 : 0) +
    (differences.contentKindChanged ? 1 : 0) + (differences.contentChanged ? 1 : 0);
  const expectedStatus = failed ? "failed" : evidenceScore >= 3 ? "verified" : "inconclusive";
  if (result.status !== expectedStatus || result.isProceedAllowed !== (expectedStatus === "verified")) {
    throw new Error("Invalid Auth Check worker result.");
  }
}
