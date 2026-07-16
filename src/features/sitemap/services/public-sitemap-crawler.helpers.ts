import { load } from "cheerio";
import {
  DiscoveredForm,
  DiscoveredUrl,
  PublicSitemapCrawlerLimits,
} from "./public-sitemap-crawler.types";
import { createAbsoluteCrawlUrl, normalizeCrawlUrl } from "./sitemap-crawler-url";
import { XMLParser } from "fast-xml-parser";
import { defaultPublicSitemapCrawlerLimits } from "./public-sitemap-crawler.config";

export function mergeLimits(
  baseLimits: Partial<PublicSitemapCrawlerLimits> | undefined,
  inputLimits: Partial<PublicSitemapCrawlerLimits> | undefined,
): PublicSitemapCrawlerLimits {
  return {
    ...defaultPublicSitemapCrawlerLimits,
    ...baseLimits,
    ...inputLimits,
  };
}

export function normalizeRootUrl(value: string) {
  const url = new URL(value);

  return new URL("/", url.origin);
}

export function getOrigin(value: URL) {
  return value.origin;
}

export function isSameOrigin(url: URL, origin: string) {
  return url.origin === origin;
}

export function getPath(value: URL) {
  return `${value.pathname}${value.search}`;
}

export function getContentType(response: Response) {
  return response.headers.get("content-type")?.toLowerCase() ?? "";
}

export function isHtmlResponse(response: Response) {
  const contentType = getContentType(response);

  return contentType.includes("text/html") || contentType.includes("application/xhtml+xml");
}

export function isXmlResponse(response: Response) {
  const contentType = getContentType(response);

  return contentType.includes("xml") || contentType.includes("text/plain");
}

export function toErrorMessage(error: unknown) {
  if (error instanceof Error && error.message) {
    return error.message;
  }

  return "Public sitemap crawl failed.";
}

export function getFormMethod(value: string | undefined) {
  return value?.trim().toUpperCase() || "GET";
}

export function extractRobotsSitemapUrls(body: string, rootUrl: URL) {
  return body
    .split(/\r?\n/)
    .map((line) => line.match(/^\s*sitemap:\s*(.+?)\s*$/i)?.[1])
    .filter((value): value is string => Boolean(value))
    .map((value) => createAbsoluteCrawlUrl(value, rootUrl))
    .filter((url): url is URL => Boolean(url));
}

export function collectXmlValues(value: unknown, key: string, results: string[]) {
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

const sitemapXmlParser = new XMLParser({
  ignoreAttributes: false,
  isArray: (name) => ["url", "sitemap"].includes(name),
});

export function extractSitemapXmlUrls(body: string, rootUrl: URL) {
  const parsed = sitemapXmlParser.parse(body);
  const locValues: string[] = [];
  collectXmlValues(parsed, "loc", locValues);

  return locValues
    .map((value) => createAbsoluteCrawlUrl(value, rootUrl))
    .filter((url): url is URL => Boolean(url));
}

export function extractHtmlDiscoveries(body: string, pageUrl: URL) {
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
    const url = action ? createAbsoluteCrawlUrl(action, pageUrl) : normalizeCrawlUrl(pageUrl);
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
