import { load } from "cheerio";
import type {
  AuthCheckWorkerConfiguration,
  AuthCheckWorkerContentKind,
  AuthCheckWorkerLegSignals,
  AuthCheckWorkerResult,
} from "./auth-check-worker.types";

const forbiddenHeaders = new Set([
  "connection", "content-length", "host", "proxy-authorization", "proxy-connection",
  "transfer-encoding", "upgrade",
]);

interface InternalResponseSignals extends AuthCheckWorkerLegSignals {
  redirects: string[];
  contentFingerprint: string;
  contentTypeFingerprint: string;
  titleText: string | null;
}

type AuthCheckFetch = (input: RequestInfo | URL, init?: RequestInit | BunFetchRequestInit) => Promise<Response>;

export function parseAuthCheckWorkerConfiguration(value: unknown): AuthCheckWorkerConfiguration {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error("Invalid Auth Check worker configuration.");
  }
  const record = value as Record<string, unknown>;
  const keys = [
    "version", "operation", "contextVersion", "targetOrigin", "verificationUrl", "authenticatedHeaders",
    "requestTimeoutMs", "maximumResponseBytes", "maximumRedirectCount", "totalDeadlineMs",
  ];
  if (Object.keys(record).length !== keys.length || keys.some((key) => !(key in record)) ||
      record.version !== 1 || record.operation !== "auth-check") {
    throw new Error("Invalid Auth Check worker configuration.");
  }
  if (typeof record.targetOrigin !== "string" || Buffer.byteLength(record.targetOrigin) > 512 ||
      typeof record.contextVersion !== "number" || !Number.isSafeInteger(record.contextVersion) || record.contextVersion < 0 ||
      typeof record.verificationUrl !== "string" || Buffer.byteLength(record.verificationUrl) > 8192 ||
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
    if (Buffer.byteLength(header) > 8192 || /[\u0000-\u001f\u007f-\u009f]/.test(header)) {
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
  return value as AuthCheckWorkerConfiguration;
}

export function createAuthCheckWorkerProxyFetch(proxyUrl: string): AuthCheckFetch {
  const proxy = validateProxyUrl(proxyUrl);
  return (input, init) => fetch(input, { ...init, proxy });
}

export function getAuthCheckWorkerProxyUrl(environment: Record<string, string | undefined>): string {
  const proxyUrl = environment.HTTP_PROXY;
  if (!proxyUrl || environment.HTTPS_PROXY !== proxyUrl || environment.ALL_PROXY !== proxyUrl || environment.NO_PROXY !== "") {
    throw new Error("Auth Check worker proxy configuration is unavailable.");
  }
  validateProxyUrl(proxyUrl);
  return proxyUrl;
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
  return value as AuthCheckWorkerResult;
}

export async function runAuthCheckWorker(
  configuration: AuthCheckWorkerConfiguration,
  fetchRequest: AuthCheckFetch = fetch,
): Promise<AuthCheckWorkerResult> {
  configuration = parseAuthCheckWorkerConfiguration(configuration);
  const totalDeadline = AbortSignal.timeout(configuration.totalDeadlineMs);
  const unauthenticated = await fetchLeg(configuration, [], totalDeadline, fetchRequest);
  const authenticated = await fetchLeg(
    configuration,
    configuration.authenticatedHeaders,
    totalDeadline,
    fetchRequest,
  );
  const differences = {
    statusChanged: unauthenticated.status !== authenticated.status,
    redirectsChanged: JSON.stringify(unauthenticated.redirects) !== JSON.stringify(authenticated.redirects),
    contentKindChanged: unauthenticated.contentTypeFingerprint !== authenticated.contentTypeFingerprint,
    contentChanged: unauthenticated.contentFingerprint !== authenticated.contentFingerprint,
    titleChanged: unauthenticated.titleText !== authenticated.titleText,
    loginFormChanged: unauthenticated.hasLoginForm !== authenticated.hasLoginForm,
  };
  const blocked = unauthenticated.status === 401 || unauthenticated.status === 403;
  const successful = authenticated.status >= 200 && authenticated.status < 300;
  const statusImproved = blocked && successful;
  const loginFormRemoved = unauthenticated.hasLoginForm && !authenticated.hasLoginForm;
  let status: AuthCheckWorkerResult["status"];
  let isProceedAllowed = false;
  if (authenticated.status >= 400 || authenticated.hasCrossOriginRedirect ||
      (authenticated.hasLoginForm && !loginFormRemoved)) {
    status = "failed";
  } else {
    const evidenceScore = (statusImproved ? 3 : 0) + (loginFormRemoved ? 3 : 0) +
      (differences.redirectsChanged ? 2 : 0) + (differences.titleChanged ? 2 : 0) +
      (differences.contentKindChanged ? 1 : 0) + (differences.contentChanged ? 1 : 0);
    if (evidenceScore >= 3) {
      status = "verified";
      isProceedAllowed = true;
    } else {
      status = "inconclusive";
    }
  }
  return {
    version: 1,
    operation: "auth-check",
    status,
    isProceedAllowed,
    unauthenticated: publicSignals(unauthenticated),
    authenticated: publicSignals(authenticated),
    differences,
  };
}

async function fetchLeg(
  configuration: AuthCheckWorkerConfiguration,
  privateHeaders: string[],
  totalDeadline: AbortSignal,
  fetchRequest: AuthCheckFetch,
): Promise<InternalResponseSignals> {
  const targetOrigin = configuration.targetOrigin;
  const redirects: string[] = [];
  let currentUrl = new URL(configuration.verificationUrl);
  for (let count = 0; ; count += 1) {
    const headers = new Headers({
      accept: "text/html,application/xhtml+xml,application/json;q=0.9,*/*;q=0.8",
    });
    if (privateHeaders.length > 0) {
      for (const line of privateHeaders) {
        const separator = line.indexOf(":");
        headers.set(line.slice(0, separator).trim(), line.slice(separator + 1).trim());
      }
    }
    const requestSignal = AbortSignal.any([totalDeadline, AbortSignal.timeout(configuration.requestTimeoutMs)]);
    const response = await withAbort(fetchRequest(currentUrl, {
      method: "GET",
      headers,
      redirect: "manual",
      signal: requestSignal,
    }), requestSignal);
    const location = response.headers.get("location");
    if (response.status < 300 || response.status >= 400 || !location) {
      return inspectResponse(response, redirects, await readBoundedResponse(response, configuration.maximumResponseBytes, requestSignal));
    }
    if (count >= configuration.maximumRedirectCount) throw new Error("Auth Check worker request failed.");
    const nextUrl = new URL(location, currentUrl);
    if (nextUrl.username || nextUrl.password) {
      cancelResponseBody(response.body);
      throw new Error("Auth Check worker request failed.");
    }
    if (nextUrl.origin !== targetOrigin) {
      redirects.push("cross-origin");
      cancelResponseBody(response.body);
      return inspectResponse(response, redirects, "");
    }
    nextUrl.hash = "";
    redirects.push(`${nextUrl.pathname}${nextUrl.search}`);
    cancelResponseBody(response.body);
    currentUrl = nextUrl;
  }
}

async function readBoundedResponse(response: Response, maximumBytes: number, signal: AbortSignal): Promise<string> {
  if (!response.body) return "";
  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let totalBytes = 0;
  try {
    while (true) {
      const { done, value } = await withAbort(reader.read(), signal);
      if (done) break;
      totalBytes += value.byteLength;
      if (totalBytes > maximumBytes) {
        cancelReader(reader);
        throw new Error("Auth Check worker request failed.");
      }
      chunks.push(value);
    }
  } catch {
    cancelReader(reader);
    throw new Error("Auth Check worker request failed.");
  } finally {
    try {
      reader.releaseLock();
    } catch {
      // A non-cooperative stream may leave a read pending after the deadline.
    }
  }
  const body = new Uint8Array(totalBytes);
  let offset = 0;
  for (const chunk of chunks) {
    body.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return new TextDecoder("utf-8", { fatal: false }).decode(body);
}

function inspectResponse(response: Response, redirects: string[], body: string): InternalResponseSignals {
  const rawContentType = response.headers.get("content-type")?.split(";", 1)[0]?.trim().toLowerCase() ?? "";
  const contentKind = normalizeContentKind(rawContentType);
  let titleText: string | null = null;
  let hasLoginForm = false;
  if (contentKind === "html" || contentKind === "xhtml") {
    const $ = load(body);
    const title = $("title").first().text().replace(/\s+/g, " ").trim().slice(0, 256);
    titleText = title || null;
    hasLoginForm = $("form").toArray().some((form) => $(form).find('input[type="password"]').length > 0);
  }
  return {
    status: response.status,
    redirectCount: redirects.length,
    hasCrossOriginRedirect: redirects.includes("cross-origin"),
    contentKind,
    hasLoginForm,
    redirects,
    contentFingerprint: String(Bun.hash(body)),
    contentTypeFingerprint: rawContentType,
    titleText,
  };
}

function publicSignals(signals: InternalResponseSignals): AuthCheckWorkerLegSignals {
  return {
    status: signals.status,
    redirectCount: signals.redirectCount,
    hasCrossOriginRedirect: signals.hasCrossOriginRedirect,
    contentKind: signals.contentKind,
    hasLoginForm: signals.hasLoginForm,
  };
}

function normalizeContentKind(value: string): AuthCheckWorkerContentKind {
  if (value === "text/html") return "html";
  if (value === "application/xhtml+xml") return "xhtml";
  if (value === "application/json" || value.endsWith("+json")) return "json";
  return "other";
}

function parseHttpUrl(value: string): URL {
  const url = new URL(value);
  if (url.protocol !== "http:" && url.protocol !== "https:") throw new Error("Auth Check requires HTTP or HTTPS.");
  return url;
}

function validateProxyUrl(value: string): string {
  const proxy = new URL(value);
  if ((proxy.protocol !== "http:" && proxy.protocol !== "https:") || proxy.username || proxy.password ||
      proxy.pathname !== "/" || proxy.search || proxy.hash || proxy.port !== "3128") {
    throw new Error("Auth Check worker proxy configuration is invalid.");
  }
  return proxy.toString();
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
      (leg.redirectCount > 5 && !leg.hasCrossOriginRedirect) ||
      (leg.hasLoginForm && !hasHtmlContent)) {
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

function cancelResponseBody(body: ReadableStream<Uint8Array> | null): void {
  if (body) void body.cancel().catch(() => undefined);
}

function cancelReader(reader: ReadableStreamDefaultReader<Uint8Array>): void {
  void reader.cancel().catch(() => undefined);
}

function withAbort<T>(promise: Promise<T>, signal: AbortSignal): Promise<T> {
  if (signal.aborted) return Promise.reject(new Error("Auth Check worker request failed."));
  return new Promise((resolve, reject) => {
    const abort = () => reject(new Error("Auth Check worker request failed."));
    signal.addEventListener("abort", abort, { once: true });
    promise.then(resolve, reject).finally(() => signal.removeEventListener("abort", abort));
  });
}
