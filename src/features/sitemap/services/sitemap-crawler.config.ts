import { SitemapCrawlerLimits } from "./sitemap-crawler.types";

export const defaultSitemapCrawlerLimits = {
  maxDepth: 3,
  maxPages: 50,
  requestTimeoutMs: 10_000,
  maxResponseBytes: 1_000_000,
} as const satisfies SitemapCrawlerLimits;
