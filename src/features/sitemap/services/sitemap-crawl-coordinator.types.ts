export type SitemapCrawlStartState =
  "started" | "already_running" | "paused" | "completed" | "failed";

export type SitemapCrawlControlState =
  "started" | "pause_requested" | "already_running" | "unavailable";

export interface EnsureSitemapCrawlInput {
  targetId: string;
  rootUrl: string;
}

export interface EnsureSitemapCrawlResult {
  state: SitemapCrawlStartState;
}
