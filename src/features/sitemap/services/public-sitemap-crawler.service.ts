import { load } from "cheerio";
import { XMLParser } from "fast-xml-parser";
import {
  TargetSitemapEntrySource,
  UpsertTargetSitemapEntryInput,
} from "../model/sitemap.types";
import { sitemapRepository } from "./sitemap.repository";

interface PublicSitemapCrawlerPersistence {
  upsertEntry(input: UpsertTargetSitemapEntryInput): unknown;
  markCrawlRunning(targetId: string): unknown;
  markCrawlCompleted(targetId: string): unknown;
  markCrawlFailed(targetId: string, errorMessage: string): unknown;
}

type FetchFunction = (
  input: string,
  init?: RequestInit,
) => Promise<Response>;

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
}

export interface PublicSitemapCrawlerResult {
  status: "completed" | "failed";
  pagesFetched: number;
  entriesDiscovered: number;
  errorMessage?: string;
}

interface PublicSitemapCrawlerOptions {
  repository?: PublicSitemapCrawlerPersistence;
  fetch?: FetchFunction;
  limits?: Partial<PublicSitemapCrawlerLimits>;
}

const defaultCrawlerLimits: PublicSitemapCrawlerLimits = {
  maxDepth: 3,
  maxPages: 50,
  requestTimeoutMs: 10_000,
  maxResponseBytes: 1_000_000,
};

const sitemapXmlParser = new XMLParser({
  ignoreAttributes: false,
  isArray: (name) => ["url", "sitemap"].includes(name),
});

function mergeLimits(
  baseLimits: Partial<PublicSitemapCrawlerLimits> | undefined,
  inputLimits: Partial<PublicSitemapCrawlerLimits> | undefined,
): PublicSitemapCrawlerLimits {
  return {
    ...defaultCrawlerLimits,
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

function normalizeUrl(value: URL) {
  const normalized = new URL(value.toString());
  normalized.hash = "";

  return normalized;
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

function createAbsoluteUrl(value: string | undefined, baseUrl: URL) {
  if (!value || value.startsWith("javascript:") || value.startsWith("mailto:")) {
    return null;
  }

  try {
    return normalizeUrl(new URL(value, baseUrl));
  } catch {
    return null;
  }
}

function getFormMethod(value: string | undefined) {
  return value?.trim().toUpperCase() || "GET";
}

function extractRobotsSitemapUrls(body: string, rootUrl: URL) {
  return body
    .split(/\r?\n/)
    .map((line) => line.match(/^\s*sitemap:\s*(.+?)\s*$/i)?.[1])
    .filter((value): value is string => Boolean(value))
    .map((value) => createAbsoluteUrl(value, rootUrl))
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
    .map((value) => createAbsoluteUrl(value, rootUrl))
    .filter((url): url is URL => Boolean(url));
}

function extractHtmlDiscoveries(body: string, pageUrl: URL) {
  const $ = load(body);
  const links: DiscoveredUrl[] = [];
  const forms: DiscoveredForm[] = [];

  $("a[href], link[href]").each((_, element) => {
    const url = createAbsoluteUrl($(element).attr("href"), pageUrl);
    if (url) {
      links.push({
        url,
        source: "html_link",
      });
    }
  });

  $("form").each((_, element) => {
    const method = getFormMethod($(element).attr("method"));
    const url = createAbsoluteUrl($(element).attr("action") ?? ".", pageUrl);
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

async function readResponseText(response: Response, maxBytes: number) {
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

  constructor(options: PublicSitemapCrawlerOptions = {}) {
    this.repository = options.repository ?? sitemapRepository;
    this.fetch = options.fetch ?? globalThis.fetch.bind(globalThis);
    this.limits = options.limits ?? {};
  }

  async crawl(
    input: PublicSitemapCrawlerInput,
  ): Promise<PublicSitemapCrawlerResult> {
    const limits = mergeLimits(this.limits, input.limits);
    const rootUrl = normalizeRootUrl(input.rootUrl);
    const origin = getOrigin(rootUrl);
    const queue: QueuedUrl[] = [
      {
        url: rootUrl,
        depth: 0,
        source: "seed",
      },
    ];
    const queuedUrls = new Set([rootUrl.toString()]);
    const visitedUrls = new Set<string>();
    const discoveredEntries = new Set<string>();
    let pagesFetched = 0;

    this.repository.markCrawlRunning(input.targetId);

    try {
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

      while (queue.length > 0 && pagesFetched < limits.maxPages) {
        const next = queue.shift();
        if (!next || next.depth > limits.maxDepth) {
          continue;
        }

        const normalizedUrl = normalizeUrl(next.url);
        const normalizedUrlValue = normalizedUrl.toString();
        if (visitedUrls.has(normalizedUrlValue)) {
          continue;
        }

        visitedUrls.add(normalizedUrlValue);

        const response = await this.fetchWithTimeout(
          normalizedUrl,
          limits.requestTimeoutMs,
        );
        this.persistEntry(
          input.targetId,
          normalizedUrl,
          "GET",
          response.status,
          next.source,
          next.depth,
        );
        discoveredEntries.add(`GET ${normalizedUrlValue}`);

        if (!response.ok || !isHtmlResponse(response)) {
          continue;
        }

        pagesFetched += 1;
        const body = await readResponseText(response, limits.maxResponseBytes);
        const discoveries = extractHtmlDiscoveries(body, normalizedUrl);

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
    }
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
      const robotsResponse = await this.fetchWithTimeout(
        robotsUrl,
        limits.requestTimeoutMs,
      );
      if (robotsResponse.ok) {
        const body = await readResponseText(
          robotsResponse,
          limits.maxResponseBytes,
        );
        extractRobotsSitemapUrls(body, rootUrl).forEach((url) => {
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

    for (const [sitemapUrlValue, source] of sitemapUrls) {
      const sitemapUrl = new URL(sitemapUrlValue);
      if (!isSameOrigin(sitemapUrl, origin)) {
        continue;
      }

      try {
        const response = await this.fetchWithTimeout(
          sitemapUrl,
          limits.requestTimeoutMs,
        );
        this.persistEntry(targetId, sitemapUrl, "GET", response.status, source, 0);
        discoveredEntries.add(`GET ${sitemapUrl.toString()}`);
        if (!response.ok || !isXmlResponse(response)) {
          continue;
        }

        const body = await readResponseText(response, limits.maxResponseBytes);
        extractSitemapXmlUrls(body, rootUrl).forEach((url) => {
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
    const normalizedUrl = normalizeUrl(url).toString();
    if (queuedUrls.has(normalizedUrl)) {
      return;
    }

    queuedUrls.add(normalizedUrl);
    queue.push({
      url: normalizeUrl(url),
      depth,
      source,
    });
  }

  private async fetchWithTimeout(url: URL, requestTimeoutMs: number) {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), requestTimeoutMs);

    try {
      return await this.fetch(url.toString(), {
        redirect: "follow",
        signal: controller.signal,
      });
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
    const normalizedUrl = normalizeUrl(url);

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
