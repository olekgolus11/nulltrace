import { load } from "cheerio";
import { XMLParser } from "fast-xml-parser";
import type { DiscoveredForm, DiscoveredUrl } from "./public-sitemap-crawler.types";
import { createAbsoluteCrawlUrl, normalizeCrawlUrl } from "./sitemap-crawler-url";

export function isXmlResponse(response: Response) {
  const contentType = response.headers.get("content-type")?.toLowerCase() ?? "";

  return contentType.includes("xml") || contentType.includes("text/plain");
}

export function toErrorMessage(error: unknown) {
  if (error instanceof Error && error.message) {
    return error.message;
  }

  return "Public sitemap crawl failed.";
}

export function extractRobotsSitemapUrls(body: string, rootUrl: URL) {
  return body
    .split(/\r?\n/)
    .map((line) => line.match(/^\s*sitemap:\s*(.+?)\s*$/i)?.[1])
    .filter((value): value is string => Boolean(value))
    .map((value) => createAbsoluteCrawlUrl(value, rootUrl))
    .filter((url): url is URL => Boolean(url));
}

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

function getFormMethod(value: string | undefined) {
  return value?.trim().toUpperCase() || "GET";
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

const sitemapXmlParser = new XMLParser({
  ignoreAttributes: false,
  isArray: (name) => ["url", "sitemap"].includes(name),
});
