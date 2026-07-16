import { SitemapCrawlRunMode, TargetSitemapEntrySource } from "../model/sitemap.types";

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

export interface DiscoveredUrl {
  url: URL;
  source: TargetSitemapEntrySource;
}

export interface DiscoveredForm {
  url: URL;
  method: string;
}
