import { load } from "cheerio";
import { authCheckService } from "../../authentication/services/auth-check.service";
import type {
  AuthenticatedContextVerificationResult,
  AuthenticatedContextVerifier,
} from "../../authentication/services/auth-check.types";
import { splitAuthenticatedHeaderEntries } from "../../authentication/services/authenticated-request-context-redaction";
import { SitemapCrawlFailure } from "../model/sitemap.types";
import { sitemapRepository } from "./sitemap.repository";
import { createAbsoluteCrawlUrl } from "./sitemap-crawler-url";
import { defaultSitemapCrawlerLimits } from "./sitemap-crawler.config";
import { isHtmlResponse, readResponseText } from "./sitemap-crawler.helpers";
import type { QueuedUrl, SitemapCrawlerLimits } from "./sitemap-crawler.types";
import { isAuthenticationSignal, toErrorMessage } from "./authenticated-sitemap-crawler.helpers";
import {
  AuthenticatedSitemapCrawlerPersistence,
  AuthenticatedSitemapCrawlerInput,
  AuthenticatedSitemapCrawlerResult,
} from "./authenticated-sitemap-crawler.types";
import { TemporaryCookieJar } from "./authenticated-sitemap-cookie-jar";

type FetchFunction = (input: string, init?: RequestInit) => Promise<Response>;

interface AuthenticatedSitemapCrawlerOptions {
  repository?: AuthenticatedSitemapCrawlerPersistence;
  fetch?: FetchFunction;
  limits?: Partial<SitemapCrawlerLimits>;
  authenticationVerifier?: AuthenticatedContextVerifier;
}

interface AuthenticatedSitemapCrawlerState {
  queue: QueuedUrl[];
  visited: Set<string>;
  discoveredEntryKeys: Set<string>;
  failures: SitemapCrawlFailure[];
  pagesFetched: number;
}

interface AuthenticatedSitemapCrawlerRuntimeState {
  authenticationVerification: AuthenticatedContextVerificationResult | null;
  cookieJar: TemporaryCookieJar;
  queuedUrls: Set<string>;
}

export class AuthenticatedSitemapCrawler {
  private readonly repository: AuthenticatedSitemapCrawlerPersistence;
  private readonly fetch: FetchFunction;
  private readonly limits: Partial<SitemapCrawlerLimits>;
  private readonly authenticationVerifier: AuthenticatedContextVerifier;
  private readonly activeSessionIds = new Set<string>();
  private readonly pauseRequestedSessionIds = new Set<string>();

  constructor(options: AuthenticatedSitemapCrawlerOptions = {}) {
    this.repository = options.repository ?? sitemapRepository;
    this.fetch = options.fetch ?? globalThis.fetch.bind(globalThis);
    this.limits = options.limits ?? {};
    this.authenticationVerifier = options.authenticationVerifier ?? authCheckService;
  }

  requestPause(sessionId: string) {
    if (!this.activeSessionIds.has(sessionId)) {
      return false;
    }
    this.pauseRequestedSessionIds.add(sessionId);
    return true;
  }

  async crawl(input: AuthenticatedSitemapCrawlerInput): Promise<AuthenticatedSitemapCrawlerResult> {
    const state: AuthenticatedSitemapCrawlerState = {
      queue: [],
      visited: new Set(),
      discoveredEntryKeys: new Set(),
      failures: [],
      pagesFetched: 0,
    };
    const limits = {
      ...defaultSitemapCrawlerLimits,
      ...this.limits,
      ...input.limits,
    };

    const contextOrigin = new URL(input.context.origin).origin;
    const rootOrigin = new URL(input.rootUrl).origin;

    if (contextOrigin !== rootOrigin) {
      throw new Error("Authenticated crawl context must match the target's exact origin.");
    }

    const rootUrl = new URL("/", rootOrigin);
    const mode = input.mode ?? "fresh";
    const checkpoint =
      mode === "fresh"
        ? null
        : (this.repository.getCrawlCheckpoint?.("authenticated", input.sessionId) ?? null);

    const recoveredFrontier = checkpoint?.frontier ?? null;

    state.queue = recoveredFrontier
      ? recoveredFrontier.map((entry) => ({
          url: new URL(entry.url),
          depth: entry.depth,
          source: entry.source,
        }))
      : [{ url: rootUrl, depth: 0, source: "seed" }];
    state.visited = new Set(checkpoint?.visitedUrls ?? []);
    state.discoveredEntryKeys = new Set(checkpoint?.discoveredEntryKeys ?? []);
    state.failures = [...(checkpoint?.failures ?? [])];
    state.pagesFetched = checkpoint?.pagesFetched ?? 0;

    if (mode === "fresh") {
      this.repository.deleteCrawlCheckpoint?.("authenticated", input.sessionId);
    }
    this.activeSessionIds.add(input.sessionId);
    this.repository.markAuthenticatedCrawlRunning(input.sessionId, input.targetId);
    const runtimeState: AuthenticatedSitemapCrawlerRuntimeState = {
      authenticationVerification: null,
      cookieJar: new TemporaryCookieJar(input.context.cookies),
      queuedUrls: new Set([...state.visited, ...state.queue.map((entry) => entry.url.toString())]),
    };

    try {
      while (state.queue.length > 0 && state.visited.size < limits.maxPages) {
        const next = state.queue.shift();
        if (!next || next.depth > limits.maxDepth || state.visited.has(next.url.toString())) {
          continue;
        }
        state.visited.add(next.url.toString());
        let fetched: Awaited<ReturnType<AuthenticatedSitemapCrawler["fetchSameOrigin"]>>;
        try {
          fetched = await this.fetchSameOrigin(
            next.url,
            contextOrigin,
            input.context.headers,
            runtimeState.cookieJar,
            limits.requestTimeoutMs,
          );
        } catch (error) {
          state.failures.push({
            url: next.url.toString(),
            depth: next.depth,
            source: next.source,
            kind:
              error instanceof Error &&
              (error.name === "TimeoutError" || error.name === "AbortError")
                ? "timeout"
                : "network",
            httpStatus: null,
            errorMessage: toErrorMessage(error),
          });
          this.saveCheckpoint(input, state);
          throw error;
        }
        const { response, url } = fetched;
        runtimeState.cookieJar.accept(response);
        const record = this.repository.upsertEntry({
          targetId: input.targetId,
          normalizedUrl: url.toString(),
          path: `${url.pathname}${url.search}`,
          method: "GET",
          httpStatus: null,
          source: next.source,
          provenance: "authenticated",
          depth: next.depth,
        });
        state.discoveredEntryKeys.add(`GET ${url.toString()}`);
        this.repository.upsertAccessObservation({
          sessionId: input.sessionId,
          targetId: input.targetId,
          entryId: record.id,
          httpStatus: response.status,
        });
        const failureIndex = state.failures.findIndex(
          (failure) => failure.url === next.url.toString(),
        );
        if (failureIndex >= 0) {
          state.failures.splice(failureIndex, 1);
        }
        if (!response.ok) {
          state.failures.push({
            url: next.url.toString(),
            depth: next.depth,
            source: next.source,
            kind: "http",
            httpStatus: response.status,
            errorMessage: `HTTP ${response.status}`,
          });
        }

        const body = isHtmlResponse(response)
          ? await readResponseText(response, limits.maxResponseBytes)
          : "";
        const hasAuthenticationSignal = isAuthenticationSignal(
          response,
          url,
          body,
          fetched.crossOriginRedirectUrl,
        );
        if (hasAuthenticationSignal) {
          const authenticationResult = await this.verifyAuthenticationSignal(
            input,
            state,
            runtimeState,
            next,
          );
          if (authenticationResult) {
            return authenticationResult;
          }
          continue;
        }

        if (!response.ok || !isHtmlResponse(response)) {
          const pausedResult = this.checkpointAndPauseIfRequested(input, state);
          if (pausedResult) {
            return pausedResult;
          }
          continue;
        }
        state.pagesFetched += 1;
        const $ = load(body);
        $("a[href]").each((_, element) => {
          this.enqueue(
            $(element).attr("href"),
            url,
            contextOrigin,
            next.depth + 1,
            "html_link",
            limits.maxDepth,
            state.queue,
            runtimeState.queuedUrls,
          );
        });
        const pausedResult = this.checkpointAndPauseIfRequested(input, state);
        if (pausedResult) {
          return pausedResult;
        }
      }

      this.repository.markAuthenticatedCrawlCompleted(input.sessionId, input.targetId);
      return {
        status: "completed",
        pagesFetched: state.pagesFetched,
        entriesDiscovered: state.discoveredEntryKeys.size,
      };
    } catch (error) {
      const errorMessage = toErrorMessage(error);
      this.repository.markAuthenticatedCrawlFailed(input.sessionId, input.targetId, errorMessage);
      return {
        status: "failed",
        pagesFetched: state.pagesFetched,
        entriesDiscovered: state.discoveredEntryKeys.size,
        errorMessage,
      };
    } finally {
      runtimeState.cookieJar.clear();
      this.activeSessionIds.delete(input.sessionId);
      this.pauseRequestedSessionIds.delete(input.sessionId);
    }
  }

  private saveCheckpoint(
    input: AuthenticatedSitemapCrawlerInput,
    state: AuthenticatedSitemapCrawlerState,
  ) {
    this.repository.saveCrawlCheckpoint?.({
      crawlerType: "authenticated",
      ownerId: input.sessionId,
      targetId: input.targetId,
      rootUrl: input.rootUrl,
      frontier: state.queue.map((entry) => ({
        url: entry.url.toString(),
        depth: entry.depth,
        source: entry.source,
      })),
      visitedUrls: [...state.visited],
      failures: state.failures,
      discoveredEntryKeys: [...state.discoveredEntryKeys],
      pagesFetched: state.pagesFetched,
      entriesDiscovered: state.discoveredEntryKeys.size,
    });
  }

  private checkpointAndPauseIfRequested(
    input: AuthenticatedSitemapCrawlerInput,
    state: AuthenticatedSitemapCrawlerState,
  ): AuthenticatedSitemapCrawlerResult | null {
    this.saveCheckpoint(input, state);
    if (!this.pauseRequestedSessionIds.has(input.sessionId)) {
      return null;
    }
    this.repository.markAuthenticatedCrawlPaused?.(input.sessionId, input.targetId);
    return {
      status: "paused",
      pagesFetched: state.pagesFetched,
      entriesDiscovered: state.discoveredEntryKeys.size,
    };
  }

  private async verifyAuthenticationSignal(
    input: AuthenticatedSitemapCrawlerInput,
    state: AuthenticatedSitemapCrawlerState,
    runtimeState: AuthenticatedSitemapCrawlerRuntimeState,
    current: QueuedUrl,
  ): Promise<AuthenticatedSitemapCrawlerResult | null> {
    const pausedResult = this.checkpointAndPauseIfRequested(input, state);
    if (pausedResult) {
      return pausedResult;
    }

    runtimeState.authenticationVerification ??= await this.authenticationVerifier.verify({
      sessionId: input.sessionId,
      targetUrl: input.rootUrl,
      cookies: runtimeState.cookieJar.getHeader(),
      headers: input.context.headers,
    });
    const pauseAfterVerification = this.checkpointAndPauseIfRequested(input, state);
    if (pauseAfterVerification) {
      return pauseAfterVerification;
    }
    if (runtimeState.authenticationVerification !== "invalid") {
      return null;
    }

    const errorMessage = "Authentication verification failed during the authenticated crawl.";
    state.visited.delete(current.url.toString());
    state.queue.unshift(current);
    this.repository.markAuthenticatedCrawlAuthenticationRequired(
      input.sessionId,
      input.targetId,
      errorMessage,
    );
    this.saveCheckpoint(input, state);
    return {
      status: "authentication_required",
      pagesFetched: state.pagesFetched,
      entriesDiscovered: state.discoveredEntryKeys.size,
      errorMessage,
    };
  }

  private enqueue(
    value: string | undefined,
    baseUrl: URL,
    origin: string,
    depth: number,
    source: QueuedUrl["source"],
    maxDepth: number,
    queue: QueuedUrl[],
    queued: Set<string>,
  ) {
    const url = createAbsoluteCrawlUrl(value, baseUrl);
    if (!url || url.origin !== origin || depth > maxDepth || queued.has(url.toString())) {
      return;
    }
    queued.add(url.toString());
    queue.push({ url, depth, source });
  }

  private async fetchSameOrigin(
    initialUrl: URL,
    origin: string,
    contextHeaders: string,
    cookieJar: TemporaryCookieJar,
    timeoutMs: number,
  ) {
    let url = initialUrl;
    for (let redirects = 0; redirects < 10; redirects += 1) {
      const headers = new Headers({
        accept: "text/html,application/xhtml+xml,*/*;q=0.8",
      });
      splitAuthenticatedHeaderEntries(contextHeaders).forEach((line) => {
        const separator = line.indexOf(":");
        if (separator > 0) {
          headers.set(line.slice(0, separator).trim(), line.slice(separator + 1).trim());
        }
      });
      const cookies = cookieJar.getHeader();
      if (cookies) {
        headers.set("cookie", cookies);
      }
      const response = await this.fetch(url.toString(), {
        method: "GET",
        headers,
        redirect: "manual",
        signal: AbortSignal.timeout(timeoutMs),
      });
      const location = response.headers.get("location");
      if (response.status < 300 || response.status >= 400 || !location) {
        return { response, url, crossOriginRedirectUrl: null };
      }
      const nextUrl = createAbsoluteCrawlUrl(location, url);
      if (!nextUrl || nextUrl.origin !== origin) {
        return { response, url, crossOriginRedirectUrl: nextUrl };
      }
      cookieJar.accept(response);
      url = nextUrl;
    }
    throw new Error("Authenticated crawl redirect limit exceeded.");
  }
}

export const authenticatedSitemapCrawler = new AuthenticatedSitemapCrawler();
