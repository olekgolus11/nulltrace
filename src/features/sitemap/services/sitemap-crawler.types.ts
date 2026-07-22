import type { TargetSitemapEntrySource } from "../model/sitemap.types";

export interface SitemapCrawlerLimits {
  maxDepth: number;
  maxPages: number;
  requestTimeoutMs: number;
  maxResponseBytes: number;
}

export interface QueuedUrl {
  url: URL;
  depth: number;
  source: TargetSitemapEntrySource;
}
