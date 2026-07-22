import type {
  SitemapCrawlCheckpoint,
  SitemapCrawlFailure,
  SitemapCrawlRunMode,
  TargetSitemapEntrySource,
  UpsertTargetSitemapEntryInput,
} from "../model/sitemap.types";
import type { QueuedUrl, SitemapCrawlerLimits } from "./sitemap-crawler.types";

export type PublicSitemapFetch = (input: string, init?: RequestInit) => Promise<Response>;

export interface PublicSitemapCrawlerPersistence {
  upsertEntry(input: UpsertTargetSitemapEntryInput): unknown;
  markCrawlRunning(targetId: string): unknown;
  markCrawlCompleted(targetId: string): unknown;
  markCrawlFailed(targetId: string, errorMessage: string): unknown;
  markCrawlPaused?(targetId: string): unknown;
  saveCrawlCheckpoint?(input: Omit<SitemapCrawlCheckpoint, "updatedAt">): unknown;
  getCrawlCheckpoint?(crawlerType: "public", ownerId: string): SitemapCrawlCheckpoint | null;
  deleteCrawlCheckpoint?(crawlerType: "public", ownerId: string): unknown;
}

export interface PublicSitemapCrawlerOptions {
  repository?: PublicSitemapCrawlerPersistence;
  fetch?: PublicSitemapFetch;
  limits?: Partial<SitemapCrawlerLimits>;
}

export interface PublicSitemapCrawlerInput {
  targetId: string;
  rootUrl: string;
  limits?: Partial<SitemapCrawlerLimits>;
  mode?: SitemapCrawlRunMode;
}

export interface PublicSitemapCrawlerResult {
  status: "completed" | "paused" | "failed";
  pagesFetched: number;
  entriesDiscovered: number;
  errorMessage?: string;
}

export interface PublicSitemapCrawlerState {
  queue: QueuedUrl[];
  visited: Set<string>;
  discoveredEntryKeys: Set<string>;
  failures: SitemapCrawlFailure[];
  pagesFetched: number;
}

export interface PublicSitemapCrawlerRuntimeState {
  queuedUrls: Set<string>;
  pageRequests: number;
}

export interface PublicSitemapFetchedResponse {
  response: Response;
  url: URL;
}

export interface DiscoveredUrl {
  url: URL;
  source: TargetSitemapEntrySource;
}

export interface DiscoveredForm {
  url: URL;
  method: string;
}

export interface EnqueueSitemapXmlDiscoveriesInput {
  body: string;
  baseUrl: URL;
  targetId: string;
  depth: number;
  origin: string;
  limits: SitemapCrawlerLimits;
  state: PublicSitemapCrawlerState;
  runtimeState: PublicSitemapCrawlerRuntimeState;
}

export interface EnqueueDiscoveredUrlInput {
  targetId: string;
  discovered: DiscoveredUrl;
  depth: number;
  origin: string;
  limits: SitemapCrawlerLimits;
  state: PublicSitemapCrawlerState;
  runtimeState: PublicSitemapCrawlerRuntimeState;
}
