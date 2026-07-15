import { load } from "cheerio";
import { XMLParser } from "fast-xml-parser";
import {
  SitemapCrawlCheckpoint,
  SitemapCrawlRunMode,
  TargetSitemapEntrySource,
  UpsertTargetSitemapEntryInput,
} from "../model/sitemap.types";
import { selectTransientCrawlFailures } from "../model/sitemap-crawl-lifecycle";
import { sitemapRepository } from "./sitemap.repository";
import {
  createAbsoluteCrawlUrl,
  normalizeCrawlUrl,
} from "./sitemap-crawler-url";

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

type FetchFunction = (
  input: string,
  init?: RequestInit,
) => Promise<Response>;

interface FetchedResponse {
  response: Response;
  url: URL;
}

interface QueuedUrl {
  url: URL;
  depth: number;
  source: TargetSitemapEntrySource;
}

interface DiscoveredUrl {
  url: URL;
  source: TargetSitemapEntrySource;
}

interface DiscoveredForm {
  url: URL;
  method: string;
}

export interface PublicSitemapCrawlerLimits {
  maxDepth: number;
  maxPages: number;
  requestTimeoutMs: number;
  maxResponseBytes: number;
}

export interface PublicSitemapCrawlerInput {
  targetId: string;
  rootUrl: string;
  limits?: Partial<PublicSitemapCrawlerLimits>;
  mode?: SitemapCrawlRunMode;
}

export interface PublicSitemapCrawlerResult {
  status: "completed" | "paused" | "failed";
  pagesFetched: number;
  entriesDiscovered: number;
  errorMessage?: string;
}

interface PublicSitemapCrawlerOptions {
  repository?: PublicSitemapCrawlerPersistence;
  fetch?: FetchFunction;
  limits?: Partial<PublicSitemapCrawlerLimits>;
}

export const defaultPublicSitemapCrawlerLimits = {
  maxDepth: 3,
  maxPages: 50,
  requestTimeoutMs: 10_000,
  maxResponseBytes: 1_000_000,
} as const satisfies PublicSitemapCrawlerLimits;

const sitemapXmlParser = new XMLParser({
  ignoreAttributes: false,
  isArray: (name) => ["url", "sitemap"].includes(name),
});

function mergeLimits(
  baseLimits: Partial<PublicSitemapCrawlerLimits> | undefined,
  inputLimits: Partial<PublicSitemapCrawlerLimits> | undefined,
): PublicSitemapCrawlerLimits {
  return {
    ...defaultPublicSitemapCrawlerLimits,
    ...baseLimits,
    ...inputLimits,
  };
}

function normalizeRootUrl(value: string) {
  const url = new URL(value);

  return new URL("/", url.origin);
}

function getOrigin(value: URL) {
  return value.origin;
}

function isSameOrigin(url: URL, origin: string) {
  return url.origin === origin;
}

function getPath(value: URL) {
  return `${value.pathname}${value.search}`;
}

function getContentType(response: Response) {
  return response.headers.get("content-type")?.toLowerCase() ?? "";
}

function isHtmlResponse(response: Response) {
  const contentType = getContentType(response);

  return (
    contentType.includes("text/html") ||
    contentType.includes("application/xhtml+xml")
  );
}

function isXmlResponse(response: Response) {
  const contentType = getContentType(response);

  return contentType.includes("xml") || contentType.includes("text/plain");
}

function toErrorMessage(error: unknown) {
  if (error instanceof Error && error.message) {
    return error.message;
  }

  return "Public sitemap crawl failed.";
}

function getFormMethod(value: string | undefined) {
  return value?.trim().toUpperCase() || "GET";
}

function extractRobotsSitemapUrls(body: string, rootUrl: URL) {
  return body
    .split(/\r?\n/)
    .map((line) => line.match(/^\s*sitemap:\s*(.+?)\s*$/i)?.[1])
    .filter((value): value is string => Boolean(value))
    .map((value) => createAbsoluteCrawlUrl(value, rootUrl))
    .filter((url): url is URL => Boolean(url));
}

function collectXmlValues(value: unknown, key: string, results: string[]) {
  if (!value || typeof value !== "object") {
    return;
  }

  if (Array.isArray(value)) {
    value.forEach((item) => collectXmlValues(item, key, results));
    return;
  }

  Object.entries(value).forEach(([entryKey, entryValue]) => {
    if (entryKey === key && typeof entryValue === "string") {
      results.push(entryValue);
      return;
    }

    collectXmlValues(entryValue, key, results);
  });
}

function extractSitemapXmlUrls(body: string, rootUrl: URL) {
  const parsed = sitemapXmlParser.parse(body);
  const locValues: string[] = [];
  collectXmlValues(parsed, "loc", locValues);

  return locValues
    .map((value) => createAbsoluteCrawlUrl(value, rootUrl))
    .filter((url): url is URL => Boolean(url));
}

function extractHtmlDiscoveries(body: string, pageUrl: URL) {
  const $ = load(body);
  const links: DiscoveredUrl[] = [];
  const forms: DiscoveredForm[] = [];

  $("a[href]").each((_, element) => {
    const url = createAbsoluteCrawlUrl($(element).attr("href"), pageUrl);
    if (url) {
      links.push({
        url,
        source: "html_link",
      });
    }
  });

  $("form").each((_, element) => {
    const method = getFormMethod($(element).attr("method"));
    const action = $(element).attr("action")?.trim();
    const url = action
      ? createAbsoluteCrawlUrl(action, pageUrl)
      : normalizeCrawlUrl(pageUrl);
    if (url) {
      forms.push({
        url,
        method,
      });
    }
  });

  return {
    links,
    forms,
  };
}

export async function readResponseText(response: Response, maxBytes: number) {
  if (!response.body) {
    const text = await response.text();
    if (new TextEncoder().encode(text).byteLength > maxBytes) {
      throw new Error(`Response body exceeded ${maxBytes} bytes.`);
    }

    return text;
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
      throw new Error(`Response body exceeded ${maxBytes} bytes.`);
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
    const checkpoint = mode === "fresh"
      ? null
      : this.repository.getCrawlCheckpoint?.("public", input.targetId) ?? null;
    const recoveredFrontier = mode === "retry_failures"
      ? selectTransientCrawlFailures(checkpoint?.failures ?? [])
      : checkpoint?.frontier ?? null;
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
    const discoveredEntries = new Set(
      checkpoint?.discoveredEntryKeys ?? [],
    );
    let pagesFetched = checkpoint?.pagesFetched ?? 0;
    const failures = mode === "retry_failures"
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
            this.enqueueUrl(queue, queuedUrls, form.url, formDepth, "html_form");
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

    if (this.pauseRequestedTargetIds.has(targetId)) {
      return;
    }

    sitemapUrls.set(defaultSitemapUrl.toString(), "sitemap_xml");

    for (const [sitemapUrlValue, source] of sitemapUrls) {
      if (this.pauseRequestedTargetIds.has(targetId)) {
        return;
      }
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
        extractSitemapXmlUrls(body, sitemapFetch.url).forEach((url) => {
          if (!isSameOrigin(url, origin) || 1 > limits.maxDepth) {
            return;
          }

          this.persistEntry(targetId, url, "GET", null, "sitemap_xml", 1);
          discoveredEntries.add(`GET ${url.toString()}`);
          this.enqueueUrl(queue, queuedUrls, url, 1, "sitemap_xml");
        });
      } catch {
        // Optional discovery source; the page crawl can still continue.
      }
    }
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
    this.enqueueUrl(queue, queuedUrls, discovered.url, depth, discovered.source);
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
