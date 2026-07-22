import type { TargetSitemapEntrySource } from "../model/sitemap.types";
import { sitemapRepository } from "./sitemap.repository";
import { createAbsoluteCrawlUrl, normalizeCrawlUrl } from "./sitemap-crawler-url";
import {
  extractHtmlDiscoveries,
  extractRobotsSitemapUrls,
  extractSitemapXmlUrls,
  isXmlResponse,
  toErrorMessage,
} from "./public-sitemap-crawler.helpers";
import { defaultSitemapCrawlerLimits } from "./sitemap-crawler.config";
import { isHtmlResponse, readResponseText } from "./sitemap-crawler.helpers";
import type { SitemapCrawlerLimits } from "./sitemap-crawler.types";
import type {
  EnqueueDiscoveredUrlInput,
  EnqueueSitemapXmlDiscoveriesInput,
  PublicSitemapCrawlerInput,
  PublicSitemapCrawlerOptions,
  PublicSitemapCrawlerPersistence,
  PublicSitemapCrawlerResult,
  PublicSitemapCrawlerRuntimeState,
  PublicSitemapCrawlerState,
  PublicSitemapFetchedResponse,
} from "./public-sitemap-crawler.types";

export class PublicSitemapCrawler {
  private readonly repository: PublicSitemapCrawlerPersistence;
  private readonly fetch: NonNullable<PublicSitemapCrawlerOptions["fetch"]>;
  private readonly limits: Partial<SitemapCrawlerLimits>;
  private readonly activeTargetIds = new Set<string>();
  private readonly pauseRequestedTargetIds = new Set<string>();

  constructor(options: PublicSitemapCrawlerOptions = {}) {
    this.repository = options.repository ?? sitemapRepository;
    this.fetch = options.fetch ?? globalThis.fetch.bind(globalThis);
    this.limits = options.limits ?? {};
  }

  requestPause(targetId: string) {
    if (!this.activeTargetIds.has(targetId)) {
      return false;
    }
    this.pauseRequestedTargetIds.add(targetId);
    return true;
  }

  async crawl(input: PublicSitemapCrawlerInput): Promise<PublicSitemapCrawlerResult> {
    const state: PublicSitemapCrawlerState = {
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
    const inputUrl = new URL(input.rootUrl);
    const rootUrl = new URL("/", inputUrl.origin);
    const origin = rootUrl.origin;
    const mode = input.mode ?? "fresh";
    const checkpoint =
      mode === "fresh"
        ? null
        : (this.repository.getCrawlCheckpoint?.("public", input.targetId) ?? null);
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
    const runtimeState: PublicSitemapCrawlerRuntimeState = {
      queuedUrls: new Set([...state.visited, ...state.queue.map((entry) => entry.url.toString())]),
      pageRequests: 0,
    };

    if (mode === "fresh") {
      this.repository.deleteCrawlCheckpoint?.("public", input.targetId);
    }
    this.activeTargetIds.add(input.targetId);
    this.repository.markCrawlRunning(input.targetId);

    try {
      if (!checkpoint) {
        this.persistEntry(input.targetId, rootUrl, "GET", null, "seed", 0);
        state.discoveredEntryKeys.add(`GET ${rootUrl.toString()}`);

        await this.discoverSitemaps(input.targetId, rootUrl, origin, limits, state, runtimeState);
        const pausedResult = this.checkpointAndPauseIfRequested(input, state);
        if (pausedResult) {
          return pausedResult;
        }
      }

      while (state.queue.length > 0 && runtimeState.pageRequests < limits.maxPages) {
        const next = state.queue.shift();
        if (!next || next.depth > limits.maxDepth) {
          continue;
        }

        const normalizedUrl = normalizeCrawlUrl(next.url);
        const normalizedUrlValue = normalizedUrl.toString();
        if (state.visited.has(normalizedUrlValue)) {
          continue;
        }

        state.visited.add(normalizedUrlValue);
        runtimeState.pageRequests += 1;

        let fetchedResponse: PublicSitemapFetchedResponse;
        try {
          fetchedResponse = await this.fetchWithTimeout(normalizedUrl, limits.requestTimeoutMs);
        } catch (error) {
          state.failures.push({
            url: normalizedUrlValue,
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
        const response = fetchedResponse.response;
        const pageUrl = fetchedResponse.url;
        state.visited.add(pageUrl.toString());
        this.persistEntry(input.targetId, pageUrl, "GET", response.status, next.source, next.depth);
        state.discoveredEntryKeys.add(`GET ${pageUrl.toString()}`);

        const previousFailureIndex = state.failures.findIndex(
          (failure) => failure.url === normalizedUrlValue,
        );
        if (previousFailureIndex >= 0) {
          state.failures.splice(previousFailureIndex, 1);
        }
        if (!response.ok) {
          state.failures.push({
            url: normalizedUrlValue,
            depth: next.depth,
            source: next.source,
            kind: "http",
            httpStatus: response.status,
            errorMessage: `HTTP ${response.status}`,
          });
        }

        if (
          response.ok &&
          isXmlResponse(response) &&
          (next.source === "robots_sitemap" || next.source === "sitemap_xml")
        ) {
          const body = await readResponseText(response, limits.maxResponseBytes);
          this.enqueueSitemapXmlDiscoveries({
            body,
            baseUrl: pageUrl,
            targetId: input.targetId,
            depth: next.depth + 1,
            origin,
            limits,
            state,
            runtimeState,
          });
          const pausedResult = this.checkpointAndPauseIfRequested(input, state);
          if (pausedResult) {
            return pausedResult;
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
        const body = await readResponseText(response, limits.maxResponseBytes);
        const discoveries = extractHtmlDiscoveries(body, pageUrl);

        discoveries.links.forEach((link) => {
          this.enqueueDiscoveredUrl({
            targetId: input.targetId,
            discovered: link,
            depth: next.depth + 1,
            origin,
            limits,
            state,
            runtimeState,
          });
        });

        discoveries.forms.forEach((form) => {
          const formDepth = next.depth + 1;
          if (form.url.origin !== origin || formDepth > limits.maxDepth) {
            return;
          }

          this.persistEntry(input.targetId, form.url, form.method, null, "html_form", formDepth);
          state.discoveredEntryKeys.add(`${form.method} ${form.url.toString()}`);

          if (form.method === "GET") {
            this.enqueueUrl(state, runtimeState, form.url, formDepth, "html_form");
          }
        });

        const pausedResult = this.checkpointAndPauseIfRequested(input, state);
        if (pausedResult) {
          return pausedResult;
        }
      }

      this.repository.markCrawlCompleted(input.targetId);

      return {
        status: "completed",
        pagesFetched: state.pagesFetched,
        entriesDiscovered: state.discoveredEntryKeys.size,
      };
    } catch (error) {
      const errorMessage = toErrorMessage(error);
      this.repository.markCrawlFailed(input.targetId, errorMessage);

      return {
        status: "failed",
        pagesFetched: state.pagesFetched,
        entriesDiscovered: state.discoveredEntryKeys.size,
        errorMessage,
      };
    } finally {
      this.activeTargetIds.delete(input.targetId);
      this.pauseRequestedTargetIds.delete(input.targetId);
    }
  }

  private saveCheckpoint(input: PublicSitemapCrawlerInput, state: PublicSitemapCrawlerState) {
    this.repository.saveCrawlCheckpoint?.({
      crawlerType: "public",
      ownerId: input.targetId,
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
    input: PublicSitemapCrawlerInput,
    state: PublicSitemapCrawlerState,
  ): PublicSitemapCrawlerResult | null {
    this.saveCheckpoint(input, state);
    if (!this.pauseRequestedTargetIds.has(input.targetId)) {
      return null;
    }
    this.repository.markCrawlPaused?.(input.targetId);
    return {
      status: "paused",
      pagesFetched: state.pagesFetched,
      entriesDiscovered: state.discoveredEntryKeys.size,
    };
  }

  private async discoverSitemaps(
    targetId: string,
    rootUrl: URL,
    origin: string,
    limits: SitemapCrawlerLimits,
    state: PublicSitemapCrawlerState,
    runtimeState: PublicSitemapCrawlerRuntimeState,
  ) {
    const sitemapUrls = new Map<string, TargetSitemapEntrySource>();
    const robotsUrl = new URL("/robots.txt", rootUrl.origin);
    const defaultSitemapUrl = new URL("/sitemap.xml", rootUrl.origin);

    try {
      const robotsFetch = await this.fetchWithTimeout(robotsUrl, limits.requestTimeoutMs);
      const robotsResponse = robotsFetch.response;
      if (robotsResponse.ok) {
        const body = await readResponseText(robotsResponse, limits.maxResponseBytes);
        extractRobotsSitemapUrls(body, robotsFetch.url).forEach((url) => {
          if (url.origin === origin) {
            sitemapUrls.set(url.toString(), "robots_sitemap");
            this.persistEntry(targetId, url, "GET", null, "robots_sitemap", 0);
            state.discoveredEntryKeys.add(`GET ${url.toString()}`);
          }
        });
      }
    } catch {
      // Optional discovery source; the page crawl can still continue.
    }

    sitemapUrls.set(defaultSitemapUrl.toString(), "sitemap_xml");
    const pendingSitemaps = [...sitemapUrls.entries()];

    for (let index = 0; index < pendingSitemaps.length; index += 1) {
      if (this.pauseRequestedTargetIds.has(targetId)) {
        pendingSitemaps.slice(index).forEach(([urlValue, pendingSource]) => {
          this.enqueueUrl(state, runtimeState, new URL(urlValue), 0, pendingSource);
        });
        return;
      }
      const [sitemapUrlValue, source] = pendingSitemaps[index]!;
      const sitemapUrl = new URL(sitemapUrlValue);
      if (sitemapUrl.origin !== origin) {
        continue;
      }

      try {
        const sitemapFetch = await this.fetchWithTimeout(sitemapUrl, limits.requestTimeoutMs);
        const response = sitemapFetch.response;
        this.persistEntry(targetId, sitemapFetch.url, "GET", response.status, source, 0);
        state.discoveredEntryKeys.add(`GET ${sitemapFetch.url.toString()}`);
        if (!response.ok || !isXmlResponse(response)) {
          continue;
        }

        const body = await readResponseText(response, limits.maxResponseBytes);
        this.enqueueSitemapXmlDiscoveries({
          body,
          baseUrl: sitemapFetch.url,
          targetId,
          depth: 1,
          origin,
          limits,
          state,
          runtimeState,
        });
      } catch {
        // Optional discovery source; the page crawl can still continue.
      }
    }
  }

  private enqueueSitemapXmlDiscoveries({
    body,
    baseUrl,
    targetId,
    depth,
    origin,
    limits,
    state,
    runtimeState,
  }: EnqueueSitemapXmlDiscoveriesInput) {
    extractSitemapXmlUrls(body, baseUrl).forEach((url) => {
      if (url.origin !== origin || depth > limits.maxDepth) {
        return;
      }

      this.persistEntry(targetId, url, "GET", null, "sitemap_xml", depth);
      state.discoveredEntryKeys.add(`GET ${url.toString()}`);
      this.enqueueUrl(state, runtimeState, url, depth, "sitemap_xml");
    });
  }

  private enqueueDiscoveredUrl({
    targetId,
    discovered,
    depth,
    origin,
    limits,
    state,
    runtimeState,
  }: EnqueueDiscoveredUrlInput) {
    if (discovered.url.origin !== origin || depth > limits.maxDepth) {
      return;
    }

    this.persistEntry(targetId, discovered.url, "GET", null, discovered.source, depth);
    state.discoveredEntryKeys.add(`GET ${discovered.url.toString()}`);
    this.enqueueUrl(state, runtimeState, discovered.url, depth, discovered.source);
  }

  private enqueueUrl(
    state: PublicSitemapCrawlerState,
    runtimeState: PublicSitemapCrawlerRuntimeState,
    url: URL,
    depth: number,
    source: TargetSitemapEntrySource,
  ) {
    const normalizedUrl = normalizeCrawlUrl(url).toString();
    if (runtimeState.queuedUrls.has(normalizedUrl)) {
      return;
    }

    runtimeState.queuedUrls.add(normalizedUrl);
    state.queue.push({
      url: normalizeCrawlUrl(url),
      depth,
      source,
    });
  }

  private async fetchWithTimeout(
    url: URL,
    requestTimeoutMs: number,
  ): Promise<PublicSitemapFetchedResponse> {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), requestTimeoutMs);
    let requestUrl = url;

    try {
      for (let redirectCount = 0; redirectCount < 10; redirectCount += 1) {
        const response = await this.fetch(requestUrl.toString(), {
          redirect: "manual",
          signal: controller.signal,
        });
        const location = response.headers.get("location");

        if (response.status < 300 || response.status >= 400 || !location) {
          return {
            response,
            url: requestUrl,
          };
        }

        const nextUrl = createAbsoluteCrawlUrl(location, requestUrl);
        if (!nextUrl || nextUrl.origin !== url.origin) {
          return {
            response,
            url: requestUrl,
          };
        }

        requestUrl = nextUrl;
      }

      throw new Error("Redirect limit exceeded.");
    } finally {
      clearTimeout(timeout);
    }
  }

  private persistEntry(
    targetId: string,
    url: URL,
    method: string,
    httpStatus: number | null,
    source: TargetSitemapEntrySource,
    depth: number,
  ) {
    const normalizedUrl = normalizeCrawlUrl(url);

    this.repository.upsertEntry({
      targetId,
      normalizedUrl: normalizedUrl.toString(),
      path: `${normalizedUrl.pathname}${normalizedUrl.search}`,
      method,
      httpStatus,
      source,
      depth,
    });
  }
}

export const publicSitemapCrawler = new PublicSitemapCrawler();
