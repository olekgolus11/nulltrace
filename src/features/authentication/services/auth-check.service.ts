import { load } from "cheerio";
import {
  AuthCheckMetadata,
  AuthCheckSignalMetadata,
  AuthenticatedRequestContextMetadata,
} from "../model/authenticated-request-context.types";
import {
  authenticatedRequestContextService,
  AuthenticatedRequestContextService,
  normalizeExactOrigin,
} from "./authenticated-request-context.service";
import {
  createUncheckedAuthCheckMetadata,
  splitAuthenticatedHeaderEntries,
} from "./authenticated-request-context-redaction";
import {
  AuthenticationContextMetadataRepository,
  authenticationContextMetadataRepository,
} from "./authentication-context-metadata.repository";

type FetchFunction = (
  input: string,
  init?: RequestInit,
) => Promise<Response>;

export interface AuthCheckResponseSignals {
  status: number;
  redirects: string[];
  contentType: string;
  contentFingerprint: string;
  title: string | null;
  hasLoginForm: boolean;
}

export interface AuthCheckResponsePair {
  unauthenticated: AuthCheckResponseSignals;
  authenticated: AuthCheckResponseSignals;
}

export interface AuthCheckComparisonResult {
  status: "verified" | "inconclusive" | "failed";
  isProceedAllowed: boolean;
  summary: string;
  signals: AuthCheckSignalMetadata;
}

export interface AuthCheckServiceOptions {
  contextService?: AuthenticatedRequestContextService;
  metadataRepository?: AuthenticationContextMetadataRepository;
  fetch?: FetchFunction;
  requestTimeoutMs?: number;
  maxResponseBytes?: number;
  maxRedirects?: number;
}

const defaultLimits = {
  requestTimeoutMs: 10_000,
  maxResponseBytes: 128_000,
  maxRedirects: 5,
} as const;

function normalizeVerificationUrl(value: string) {
  const url = new URL(value);
  if (url.protocol !== "http:" && url.protocol !== "https:") {
    throw new Error("Auth Check requires an HTTP or HTTPS URL.");
  }
  if (url.username || url.password) {
    throw new Error("Auth Check URL must not contain credentials.");
  }
  url.hash = "";
  return url;
}

export function validateAuthCheckUrl(
  targetUrl: string,
  verificationUrl: string,
): string {
  let normalizedVerificationUrl: URL;
  try {
    normalizedVerificationUrl = normalizeVerificationUrl(
      verificationUrl.trim(),
    );
  } catch (error) {
    if (error instanceof Error && error.message.includes("credentials")) {
      throw error;
    }
    throw new Error("Enter a valid HTTP or HTTPS verification URL.");
  }

  const targetOrigin = normalizeExactOrigin(targetUrl);
  if (normalizedVerificationUrl.origin !== targetOrigin) {
    throw new Error(
      "Auth Check verification URL must match the target's exact origin.",
    );
  }

  return normalizedVerificationUrl.toString();
}

function createMetadataVerificationUrl(value: string) {
  const url = new URL(value);
  url.search = "";
  return url.toString();
}

export function createAuthCheckUrlSuggestions(
  targetUrl: string,
  sitemapUrls: string[],
): string[] {
  const targetOrigin = normalizeExactOrigin(targetUrl);
  const suggestions = new Set<string>([new URL("/", targetOrigin).toString()]);

  sitemapUrls.forEach((value) => {
    try {
      const normalized = normalizeVerificationUrl(value);
      if (normalized.origin === targetOrigin) {
        suggestions.add(normalized.toString());
      }
    } catch {
      // Ignore malformed or unsupported sitemap entries.
    }
  });

  return [...suggestions];
}

function isBlockedStatus(status: number) {
  return status === 401 || status === 403;
}

function isSuccessfulStatus(status: number) {
  return status >= 200 && status < 300;
}

function createSignalMetadata({
  unauthenticated,
  authenticated,
}: AuthCheckResponsePair): AuthCheckSignalMetadata {
  return {
    unauthenticatedStatus: unauthenticated.status,
    authenticatedStatus: authenticated.status,
    unauthenticatedRedirectCount: unauthenticated.redirects.length,
    authenticatedRedirectCount: authenticated.redirects.length,
    unauthenticatedContentType: unauthenticated.contentType,
    authenticatedContentType: authenticated.contentType,
    unauthenticatedHasLoginForm: unauthenticated.hasLoginForm,
    authenticatedHasLoginForm: authenticated.hasLoginForm,
    hasStatusChanged: unauthenticated.status !== authenticated.status,
    hasRedirectsChanged:
      JSON.stringify(unauthenticated.redirects) !==
      JSON.stringify(authenticated.redirects),
    hasContentTypeChanged:
      unauthenticated.contentType !== authenticated.contentType,
    hasContentFingerprintChanged:
      unauthenticated.contentFingerprint !== authenticated.contentFingerprint,
    hasTitleChanged: unauthenticated.title !== authenticated.title,
    hasLoginFormChanged:
      unauthenticated.hasLoginForm !== authenticated.hasLoginForm,
  };
}

export function compareAuthCheckSignals(
  responses: AuthCheckResponsePair,
): AuthCheckComparisonResult {
  const signals = createSignalMetadata(responses);
  const hasStatusImproved =
    isBlockedStatus(responses.unauthenticated.status) &&
    isSuccessfulStatus(responses.authenticated.status);
  const hasLoginFormBeenRemoved =
    responses.unauthenticated.hasLoginForm &&
    !responses.authenticated.hasLoginForm;

  if (
    responses.authenticated.status >= 400 ||
    responses.authenticated.redirects.includes("cross-origin") ||
    (responses.authenticated.hasLoginForm && !hasLoginFormBeenRemoved)
  ) {
    return {
      status: "failed",
      isProceedAllowed: false,
      summary:
        "The authenticated response still appears blocked or sign-in gated. Authorization scope is not established.",
      signals,
    };
  }

  const evidenceScore =
    (hasStatusImproved ? 3 : 0) +
    (hasLoginFormBeenRemoved ? 3 : 0) +
    (signals.hasRedirectsChanged ? 2 : 0) +
    (signals.hasTitleChanged ? 2 : 0) +
    (signals.hasContentTypeChanged ? 1 : 0) +
    (signals.hasContentFingerprintChanged ? 1 : 0);

  if (evidenceScore >= 3) {
    return {
      status: "verified",
      isProceedAllowed: true,
      summary:
        "Bounded response signals indicate changed authenticated behavior. Authorization scope is not established.",
      signals,
    };
  }

  return {
    status: "inconclusive",
    isProceedAllowed: false,
    summary:
      "Auth Check was inconclusive. Explicit acknowledgement is required before authenticated work may proceed.",
    signals,
  };
}

function createRequestHeaders(cookies: string, headerLines: string) {
  const headers = new Headers({
    accept: "text/html,application/xhtml+xml,application/json;q=0.9,*/*;q=0.8",
  });

  splitAuthenticatedHeaderEntries(headerLines).forEach((entry) => {
    const separatorIndex = entry.indexOf(":");
    if (separatorIndex > 0) {
      headers.set(
        entry.slice(0, separatorIndex).trim(),
        entry.slice(separatorIndex + 1).trim(),
      );
    }
  });
  if (cookies) {
    headers.set("cookie", cookies);
  }

  return headers;
}

async function readBoundedResponseText(response: Response, maxBytes: number) {
  if (!response.body) {
    return "";
  }

  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let totalBytes = 0;

  while (true) {
    const { done, value } = await reader.read();
    if (done) {
      break;
    }
    totalBytes += value.byteLength;
    if (totalBytes > maxBytes) {
      await reader.cancel();
      throw new Error(`Auth Check response exceeded ${maxBytes} bytes.`);
    }
    chunks.push(value);
  }

  const body = new Uint8Array(totalBytes);
  let offset = 0;
  chunks.forEach((chunk) => {
    body.set(chunk, offset);
    offset += chunk.byteLength;
  });
  return new TextDecoder().decode(body);
}

function inspectResponse(
  response: Response,
  redirects: string[],
  body: string,
): AuthCheckResponseSignals {
  const contentType =
    response.headers
      .get("content-type")
      ?.split(";", 1)[0]
      ?.trim()
      .toLowerCase() ?? "";
  const isHtml =
    contentType === "text/html" || contentType === "application/xhtml+xml";
  let title: string | null = null;
  let hasLoginForm = false;

  if (isHtml) {
    const $ = load(body);
    title =
      $("title").first().text().replace(/\s+/g, " ").trim().slice(0, 256) ||
      null;
    hasLoginForm = $("form").toArray().some((form) => {
      return $(form).find('input[type="password"]').length > 0;
    });
  }

  return {
    status: response.status,
    redirects,
    contentType,
    contentFingerprint: String(Bun.hash(body)),
    title,
    hasLoginForm,
  };
}

export class AuthCheckService {
  private readonly contextService: AuthenticatedRequestContextService;
  private readonly metadataRepository: AuthenticationContextMetadataRepository;
  private readonly fetch: FetchFunction;
  private readonly requestTimeoutMs: number;
  private readonly maxResponseBytes: number;
  private readonly maxRedirects: number;

  constructor(options: AuthCheckServiceOptions = {}) {
    this.contextService =
      options.contextService ?? authenticatedRequestContextService;
    this.metadataRepository =
      options.metadataRepository ?? authenticationContextMetadataRepository;
    this.fetch = options.fetch ?? globalThis.fetch.bind(globalThis);
    this.requestTimeoutMs =
      options.requestTimeoutMs ?? defaultLimits.requestTimeoutMs;
    this.maxResponseBytes =
      options.maxResponseBytes ?? defaultLimits.maxResponseBytes;
    this.maxRedirects = options.maxRedirects ?? defaultLimits.maxRedirects;
  }

  getMetadata(sessionId: string): AuthCheckMetadata {
    return (
      this.metadataRepository.findBySessionId(sessionId)?.authCheck ??
      createUncheckedAuthCheckMetadata()
    );
  }

  async getAuthContextMetadata(
    sessionId: string,
  ): Promise<AuthenticatedRequestContextMetadata | null> {
    const contextMetadata = await this.contextService.getMetadata(sessionId);
    return contextMetadata
      ? {
          ...contextMetadata,
          authCheck: this.getMetadata(sessionId),
        }
      : null;
  }

  isProceedAllowed(sessionId: string): boolean {
    return this.getMetadata(sessionId).isProceedAllowed;
  }

  acknowledgeInconclusive(sessionId: string): AuthCheckMetadata {
    const current = this.getMetadata(sessionId);
    if (current.status !== "inconclusive") {
      throw new Error("Only an inconclusive Auth Check can be acknowledged.");
    }

    const acknowledged: AuthCheckMetadata = {
      ...current,
      acknowledgedAt: new Date().toISOString(),
      isProceedAllowed: true,
      summary:
        "The operator acknowledged an inconclusive Auth Check. Authorization scope is not established.",
    };
    this.metadataRepository.updateAuthCheck(sessionId, acknowledged);
    return acknowledged;
  }

  async run(
    sessionId: string,
    targetUrl: string,
    verificationUrl: string,
  ): Promise<AuthCheckMetadata> {
    const contextVersion = this.contextService.getAuthStateVersion(sessionId);
    const normalizedVerificationUrl = validateAuthCheckUrl(
      targetUrl,
      verificationUrl,
    );
    const context = await this.contextService.loadProtectedContext(sessionId);
    if (!context) {
      throw new Error(
        "Save an authentication context before running Auth Check.",
      );
    }
    if (context.origin !== normalizeExactOrigin(targetUrl)) {
      throw new Error(
        "Authentication context no longer matches the target origin.",
      );
    }

    try {
      const unauthenticated = await this.fetchSignals(
        normalizedVerificationUrl,
        createRequestHeaders("", ""),
      );
      if (
        this.contextService.getAuthStateVersion(sessionId) !== contextVersion
      ) {
        throw new Error("Authentication context changed during Auth Check.");
      }
      const authenticated = await this.fetchSignals(
        normalizedVerificationUrl,
        createRequestHeaders(context.cookies, context.headers),
      );
      if (
        this.contextService.getAuthStateVersion(sessionId) !== contextVersion
      ) {
        throw new Error("Authentication context changed during Auth Check.");
      }
      const comparison = compareAuthCheckSignals({
        unauthenticated,
        authenticated,
      });
      const checkedAt = new Date().toISOString();
      const metadata: AuthCheckMetadata = {
        ...comparison,
        verificationUrl: createMetadataVerificationUrl(
          normalizedVerificationUrl,
        ),
        checkedAt,
        acknowledgedAt: null,
      };
      this.metadataRepository.updateAuthCheck(sessionId, metadata);
      return metadata;
    } catch {
      if (
        this.contextService.getAuthStateVersion(sessionId) !== contextVersion
      ) {
        throw new Error(
          "Authentication context changed during Auth Check. Run it again.",
        );
      }
      this.metadataRepository.updateAuthCheck(sessionId, {
        status: "failed",
        verificationUrl: createMetadataVerificationUrl(
          normalizedVerificationUrl,
        ),
        checkedAt: new Date().toISOString(),
        acknowledgedAt: null,
        isProceedAllowed: false,
        summary:
          "Auth Check could not compare bounded responses. Authorization scope is not established.",
        signals: null,
      });
      throw new Error(
        "Auth Check could not compare the selected same-origin URL.",
      );
    }
  }

  private async fetchSignals(
    url: string,
    headers: Headers,
  ): Promise<AuthCheckResponseSignals> {
    const origin = new URL(url).origin;
    const redirects: string[] = [];
    let currentUrl = new URL(url);

    for (let redirectCount = 0; ; redirectCount += 1) {
      const response = await this.fetch(currentUrl.toString(), {
        method: "GET",
        headers,
        redirect: "manual",
        signal: AbortSignal.timeout(this.requestTimeoutMs),
      });
      const location = response.headers.get("location");
      if (response.status < 300 || response.status >= 400 || !location) {
        const body = await readBoundedResponseText(
          response,
          this.maxResponseBytes,
        );
        return inspectResponse(response, redirects, body);
      }

      if (redirectCount >= this.maxRedirects) {
        throw new Error(`Auth Check exceeded ${this.maxRedirects} redirects.`);
      }

      const nextUrl = new URL(location, currentUrl);
      if (nextUrl.origin !== origin) {
        redirects.push("cross-origin");
        const body = await readBoundedResponseText(
          response,
          this.maxResponseBytes,
        );
        return inspectResponse(response, redirects, body);
      }

      nextUrl.hash = "";
      redirects.push(nextUrl.pathname);
      currentUrl = nextUrl;
    }
  }
}

export const authCheckService = new AuthCheckService();
