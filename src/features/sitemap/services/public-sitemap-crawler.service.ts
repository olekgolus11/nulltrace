import {
  SitemapCrawlCheckpoint,
  TargetSitemapEntrySource,
  UpsertTargetSitemapEntryInput,
} from "../model/sitemap.types";
import { selectTransientCrawlFailures } from "../model/sitemap-crawl-lifecycle";
import { sitemapRepository } from "./sitemap.repository";
import {
  createAbsoluteCrawlUrl,
  normalizeCrawlUrl,
} from "./sitemap-crawler-url";
import {
  PublicSitemapCrawlerLimits,
  PublicSitemapCrawlerInput,
  PublicSitemapCrawlerResult,
  DiscoveredUrl,
} from "./public-sitemap-crawler.types";
import {
  extractHtmlDiscoveries,
  extractRobotsSitemapUrls,
  extractSitemapXmlUrls,
  getOrigin,
  getPath,
  isHtmlResponse,
  isSameOrigin,
  isXmlResponse,
  mergeLimits,
  normalizeRootUrl,
  readResponseText,
  toErrorMessage,
} from "./public-sitemap-crawler.helpers";

interface PublicSitemapCrawlerPersistence {
  upsertEntry(input: UpsertTargetSitemapEntryInput): unknown;
  markCrawlRunning(targetId: string): unknown;
  markCrawlCompleted(targetId: string): unknown;
  markCrawlFailed(targetId: string, errorMessage: string): unknown;
  markCrawlPaused?(targetId: string): unknown;
  saveCrawlCheckpoint?(
    input: Omit<SitemapCrawlCheckpoint, "updatedAt">,
  ): unknown;
  getCrawlCheckpoint?(
    crawlerType: "public",
    ownerId: string,
  ): SitemapCrawlCheckpoint | null;
  deleteCrawlCheckpoint?(crawlerType: "public", ownerId: string): unknown;
}

type FetchFunction = (input: string, init?: RequestInit) => Promise<Response>;

interface FetchedResponse {
  response: Response;
  url: URL;
}

interface QueuedUrl {
  url: URL;
  depth: number;
  source: TargetSitemapEntrySource;
}

interface PublicSitemapCrawlerOptions {
  repository?: PublicSitemapCrawlerPersistence;
  fetch?: FetchFunction;
  limits?: Partial<PublicSitemapCrawlerLimits>;
}

interface EnqueueSitemapXmlDiscoveriesInput {
  body: string;
  baseUrl: URL;
  targetId: string;
  depth: number;
  origin: string;
  limits: PublicSitemapCrawlerLimits;
  queue: QueuedUrl[];
  queuedUrls: Set<string>;
  discoveredEntries: Set<string>;
}

export const defaultPublicSitemapCrawlerLimits = {
  maxDepth: 3,
  maxPages: 50,
  requestTimeoutMs: 10_000,
  maxResponseBytes: 1_000_000,
} as const satisfies PublicSitemapCrawlerLimits;

export class PublicSitemapCrawler {
  private readonly repository: PublicSitemapCrawlerPersistence;
  private readonly fetch: FetchFunction;
  private readonly limits: Partial<PublicSitemapCrawlerLimits>;
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

  async crawl(
    input: PublicSitemapCrawlerInput,
  ): Promise<PublicSitemapCrawlerResult> {
    const limits = mergeLimits(this.limits, input.limits);
    const rootUrl = normalizeRootUrl(input.rootUrl);
    const origin = getOrigin(rootUrl);
    const mode = input.mode ?? "fresh";
    const checkpoint =
      mode === "fresh"
        ? null
        : (this.repository.getCrawlCheckpoint?.("public", input.targetId) ??
          null);
    const recoveredFrontier =
      mode === "retry_failures"
        ? selectTransientCrawlFailures(checkpoint?.failures ?? [])
        : (checkpoint?.frontier ?? null);
    const queue: QueuedUrl[] = recoveredFrontier
      ? recoveredFrontier.map((entry) => ({
          url: new URL(entry.url),
          depth: entry.depth,
          source: entry.source,
        }))
      : [{ url: rootUrl, depth: 0, source: "seed" }];
    const visitedUrls = new Set(checkpoint?.visitedUrls ?? []);
    if (mode === "retry_failures") {
      queue.forEach((entry) => visitedUrls.delete(entry.url.toString()));
    }
    const queuedUrls = new Set([
      ...visitedUrls,
      ...queue.map((entry) => entry.url.toString()),
    ]);
    const discoveredEntries = new Set(checkpoint?.discoveredEntryKeys ?? []);
    let pagesFetched = checkpoint?.pagesFetched ?? 0;
    const failures =
      mode === "retry_failures"
        ? (checkpoint?.failures ?? []).filter(
            (failure) => !selectTransientCrawlFailures([failure]).length,
          )
        : [...(checkpoint?.failures ?? [])];
    let pageRequests = 0;

    if (mode === "fresh") {
      this.repository.deleteCrawlCheckpoint?.("public", input.targetId);
    }
    this.activeTargetIds.add(input.targetId);
    this.repository.markCrawlRunning(input.targetId);

    try {
      if (!checkpoint) {
        this.persistEntry(input.targetId, rootUrl, "GET", null, "seed", 0);
        discoveredEntries.add(`GET ${rootUrl.toString()}`);

        await this.discoverSitemaps(
          input.targetId,
          rootUrl,
          origin,
          limits,
          queue,
          queuedUrls,
          discoveredEntries,
        );
        const pausedResult = this.checkpointAndPauseIfRequested(
          input,
          queue,
          visitedUrls,
          failures,
          pagesFetched,
          discoveredEntries,
        );
        if (pausedResult) {
          return pausedResult;
        }
      }

      while (queue.length > 0 && pageRequests < limits.maxPages) {
        const next = queue.shift();
        if (!next || next.depth > limits.maxDepth) {
          continue;
        }

        const normalizedUrl = normalizeCrawlUrl(next.url);
        const normalizedUrlValue = normalizedUrl.toString();
        if (visitedUrls.has(normalizedUrlValue)) {
          continue;
        }

        visitedUrls.add(normalizedUrlValue);
        pageRequests += 1;

        let fetchedResponse: FetchedResponse;
        try {
          fetchedResponse = await this.fetchWithTimeout(
            normalizedUrl,
            limits.requestTimeoutMs,
          );
        } catch (error) {
          failures.push({
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
          this.saveCheckpoint(
            input,
            queue,
            visitedUrls,
            failures,
            pagesFetched,
            discoveredEntries,
          );
          throw error;
        }
        const response = fetchedResponse.response;
        const pageUrl = fetchedResponse.url;
        visitedUrls.add(pageUrl.toString());
        this.persistEntry(
          input.targetId,
          pageUrl,
          "GET",
          response.status,
          next.source,
          next.depth,
        );
        discoveredEntries.add(`GET ${pageUrl.toString()}`);

        const previousFailureIndex = failures.findIndex(
          (failure) => failure.url === normalizedUrlValue,
        );
        if (previousFailureIndex >= 0) {
          failures.splice(previousFailureIndex, 1);
        }
        if (!response.ok) {
          failures.push({
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
          const body = await readResponseText(
            response,
            limits.maxResponseBytes,
          );
          this.enqueueSitemapXmlDiscoveries({
            body,
            baseUrl: pageUrl,
            targetId: input.targetId,
            depth: next.depth + 1,
            origin,
            limits,
            queue,
            queuedUrls,
            discoveredEntries,
          });
          const pausedResult = this.checkpointAndPauseIfRequested(
            input,
            queue,
            visitedUrls,
            failures,
            pagesFetched,
            discoveredEntries,
          );
          if (pausedResult) {
            return pausedResult;
          }
          continue;
        }

        if (!response.ok || !isHtmlResponse(response)) {
          const pausedResult = this.checkpointAndPauseIfRequested(
            input,
            queue,
            visitedUrls,
            failures,
            pagesFetched,
            discoveredEntries,
          );
          if (pausedResult) {
            return pausedResult;
          }
          continue;
        }

        pagesFetched += 1;
        const body = await readResponseText(response, limits.maxResponseBytes);
        const discoveries = extractHtmlDiscoveries(body, pageUrl);

        discoveries.links.forEach((link) => {
          this.enqueueDiscoveredUrl({
            targetId: input.targetId,
            discovered: link,
            depth: next.depth + 1,
            origin,
            limits,
            queue,
            queuedUrls,
            discoveredEntries,
          });
        });

        discoveries.forms.forEach((form) => {
          const formDepth = next.depth + 1;
          if (!isSameOrigin(form.url, origin) || formDepth > limits.maxDepth) {
            return;
          }

          this.persistEntry(
            input.targetId,
            form.url,
            form.method,
            null,
            "html_form",
            formDepth,
          );
          discoveredEntries.add(`${form.method} ${form.url.toString()}`);

          if (form.method === "GET") {
            this.enqueueUrl(
              queue,
              queuedUrls,
              form.url,
              formDepth,
              "html_form",
            );
          }
        });

        const pausedResult = this.checkpointAndPauseIfRequested(
          input,
          queue,
          visitedUrls,
          failures,
          pagesFetched,
          discoveredEntries,
        );
        if (pausedResult) {
          return pausedResult;
        }
      }

      this.repository.markCrawlCompleted(input.targetId);

      return {
        status: "completed",
        pagesFetched,
        entriesDiscovered: discoveredEntries.size,
      };
    } catch (error) {
      const errorMessage = toErrorMessage(error);
      this.repository.markCrawlFailed(input.targetId, errorMessage);

      return {
        status: "failed",
        pagesFetched,
        entriesDiscovered: discoveredEntries.size,
        errorMessage,
      };
    } finally {
      this.activeTargetIds.delete(input.targetId);
      this.pauseRequestedTargetIds.delete(input.targetId);
    }
  }

  private saveCheckpoint(
    input: PublicSitemapCrawlerInput,
    queue: QueuedUrl[],
    visitedUrls: Set<string>,
    failures: SitemapCrawlCheckpoint["failures"],
    pagesFetched: number,
    discoveredEntries: Set<string>,
  ) {
    this.repository.saveCrawlCheckpoint?.({
      crawlerType: "public",
      ownerId: input.targetId,
      targetId: input.targetId,
      rootUrl: input.rootUrl,
      frontier: queue.map((entry) => ({
        url: entry.url.toString(),
        depth: entry.depth,
        source: entry.source,
      })),
      visitedUrls: [...visitedUrls],
      failures,
      discoveredEntryKeys: [...discoveredEntries],
      pagesFetched,
      entriesDiscovered: discoveredEntries.size,
    });
  }

  private checkpointAndPauseIfRequested(
    input: PublicSitemapCrawlerInput,
    queue: QueuedUrl[],
    visitedUrls: Set<string>,
    failures: SitemapCrawlCheckpoint["failures"],
    pagesFetched: number,
    discoveredEntries: Set<string>,
  ): PublicSitemapCrawlerResult | null {
    this.saveCheckpoint(
      input,
      queue,
      visitedUrls,
      failures,
      pagesFetched,
      discoveredEntries,
    );
    if (!this.pauseRequestedTargetIds.has(input.targetId)) {
      return null;
    }
    this.repository.markCrawlPaused?.(input.targetId);
    return {
      status: "paused",
      pagesFetched,
      entriesDiscovered: discoveredEntries.size,
    };
  }

  private async discoverSitemaps(
    targetId: string,
    rootUrl: URL,
    origin: string,
    limits: PublicSitemapCrawlerLimits,
    queue: QueuedUrl[],
    queuedUrls: Set<string>,
    discoveredEntries: Set<string>,
  ) {
    const sitemapUrls = new Map<string, TargetSitemapEntrySource>();
    const robotsUrl = new URL("/robots.txt", rootUrl.origin);
    const defaultSitemapUrl = new URL("/sitemap.xml", rootUrl.origin);

    try {
      const robotsFetch = await this.fetchWithTimeout(
        robotsUrl,
        limits.requestTimeoutMs,
      );
      const robotsResponse = robotsFetch.response;
      if (robotsResponse.ok) {
        const body = await readResponseText(
          robotsResponse,
          limits.maxResponseBytes,
        );
        extractRobotsSitemapUrls(body, robotsFetch.url).forEach((url) => {
          if (isSameOrigin(url, origin)) {
            sitemapUrls.set(url.toString(), "robots_sitemap");
            this.persistEntry(targetId, url, "GET", null, "robots_sitemap", 0);
            discoveredEntries.add(`GET ${url.toString()}`);
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
          this.enqueueUrl(
            queue,
            queuedUrls,
            new URL(urlValue),
            0,
            pendingSource,
          );
        });
        return;
      }
      const [sitemapUrlValue, source] = pendingSitemaps[index]!;
      const sitemapUrl = new URL(sitemapUrlValue);
      if (!isSameOrigin(sitemapUrl, origin)) {
        continue;
      }

      try {
        const sitemapFetch = await this.fetchWithTimeout(
          sitemapUrl,
          limits.requestTimeoutMs,
        );
        const response = sitemapFetch.response;
        this.persistEntry(
          targetId,
          sitemapFetch.url,
          "GET",
          response.status,
          source,
          0,
        );
        discoveredEntries.add(`GET ${sitemapFetch.url.toString()}`);
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
          queue,
          queuedUrls,
          discoveredEntries,
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
    queue,
    queuedUrls,
    discoveredEntries,
  }: EnqueueSitemapXmlDiscoveriesInput) {
    extractSitemapXmlUrls(body, baseUrl).forEach((url) => {
      if (!isSameOrigin(url, origin) || depth > limits.maxDepth) {
        return;
      }

      this.persistEntry(targetId, url, "GET", null, "sitemap_xml", depth);
      discoveredEntries.add(`GET ${url.toString()}`);
      this.enqueueUrl(queue, queuedUrls, url, depth, "sitemap_xml");
    });
  }

  private enqueueDiscoveredUrl({
    targetId,
    discovered,
    depth,
    origin,
    limits,
    queue,
    queuedUrls,
    discoveredEntries,
  }: {
    targetId: string;
    discovered: DiscoveredUrl;
    depth: number;
    origin: string;
    limits: PublicSitemapCrawlerLimits;
    queue: QueuedUrl[];
    queuedUrls: Set<string>;
    discoveredEntries: Set<string>;
  }) {
    if (!isSameOrigin(discovered.url, origin) || depth > limits.maxDepth) {
      return;
    }

    this.persistEntry(
      targetId,
      discovered.url,
      "GET",
      null,
      discovered.source,
      depth,
    );
    discoveredEntries.add(`GET ${discovered.url.toString()}`);
    this.enqueueUrl(
      queue,
      queuedUrls,
      discovered.url,
      depth,
      discovered.source,
    );
  }

  private enqueueUrl(
    queue: QueuedUrl[],
    queuedUrls: Set<string>,
    url: URL,
    depth: number,
    source: TargetSitemapEntrySource,
  ) {
    const normalizedUrl = normalizeCrawlUrl(url).toString();
    if (queuedUrls.has(normalizedUrl)) {
      return;
    }

    queuedUrls.add(normalizedUrl);
    queue.push({
      url: normalizeCrawlUrl(url),
      depth,
      source,
    });
  }

  private async fetchWithTimeout(
    url: URL,
    requestTimeoutMs: number,
  ): Promise<FetchedResponse> {
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
        if (!nextUrl || !isSameOrigin(nextUrl, url.origin)) {
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
      path: getPath(normalizedUrl),
      method,
      httpStatus,
      source,
      depth,
    });
  }
}

export const publicSitemapCrawler = new PublicSitemapCrawler();
