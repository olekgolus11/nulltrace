import { load } from "cheerio";
import type {
  AuthCheckWorkerConfiguration,
  AuthCheckWorkerContentKind,
  AuthCheckWorkerLegSignals,
  AuthCheckWorkerResult,
} from "./auth-check-worker.types";
import { parseAuthCheckWorkerConfiguration } from "./auth-check-worker-protocol.helpers";

export { parseAuthCheckWorkerConfiguration, parseAuthCheckWorkerResult } from "./auth-check-worker-protocol.helpers";

interface InternalResponseSignals extends AuthCheckWorkerLegSignals {
  redirects: string[];
  contentFingerprint: string;
  contentTypeFingerprint: string;
  titleText: string | null;
}

type AuthCheckFetch = (input: RequestInfo | URL, init?: RequestInit | BunFetchRequestInit) => Promise<Response>;

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

function validateProxyUrl(value: string): string {
  const proxy = new URL(value);
  if ((proxy.protocol !== "http:" && proxy.protocol !== "https:") || proxy.username || proxy.password ||
      proxy.pathname !== "/" || proxy.search || proxy.hash || proxy.port !== "3128") {
    throw new Error("Auth Check worker proxy configuration is invalid.");
  }
  return proxy.toString();
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
