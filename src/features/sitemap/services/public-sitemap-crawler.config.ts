import { PublicSitemapCrawlerLimits } from "./public-sitemap-crawler.types";

export const defaultPublicSitemapCrawlerLimits = {
  maxDepth: 3,
  maxPages: 50,
  requestTimeoutMs: 10_000,
  maxResponseBytes: 1_000_000,
} as const satisfies PublicSitemapCrawlerLimits;
