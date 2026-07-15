export interface SitemapNode {
  id: string;
  entryId?: string;
  path: string;
  status: number;
  method?: string;
  normalizedUrl?: string;
  provenance?: TargetSitemapDiscoveryProvenance;
  source?: TargetSitemapEntrySource;
  accessObservation?: AuthenticatedSitemapAccessObservationRecord;
  children?: SitemapNode[];
}

export type TargetSitemapDiscoveryProvenance =
  | "public"
  | "authenticated"
  | "both";

export type TargetSitemapProvenanceFilter =
  | "all"
  | TargetSitemapDiscoveryProvenance;

export type TargetSitemapCrawlStatus =
  | "idle"
  | "running"
  | "paused"
  | "completed"
  | "failed";

export type TargetSitemapEntrySource =
  | "seed"
  | "html_link"
  | "html_form"
  | "sitemap_xml"
  | "robots_sitemap"
  | "manual";

export interface TargetSitemapEntryRecord {
  id: string;
  targetId: string;
  normalizedUrl: string;
  path: string;
  method: string | null;
  httpStatus: number | null;
  source: TargetSitemapEntrySource;
  provenance: TargetSitemapDiscoveryProvenance;
  depth: number;
  firstSeenAt: string;
  lastSeenAt: string;
  createdAt: string;
}

export interface UpsertTargetSitemapEntryInput {
  targetId: string;
  normalizedUrl: string;
  path: string;
  method?: string | null;
  httpStatus?: number | null;
  source: TargetSitemapEntrySource;
  provenance?: Exclude<TargetSitemapDiscoveryProvenance, "both">;
  depth: number;
}

export interface TargetSitemapEntryListFilters {
  targetId: string;
  limit?: number;
  offset?: number;
  depth?: number;
  maxDepth?: number;
  path?: string;
  method?: string;
  httpStatus?: number;
  source?: TargetSitemapEntrySource;
  provenance?: TargetSitemapDiscoveryProvenance;
  accessObservedBySessionId?: string;
  hasAccessObservation?: boolean;
}

export interface TargetSitemapEntryListResult {
  entries: TargetSitemapEntryRecord[];
  total: number;
  limit: number;
  offset: number;
}

export interface TargetSitemapCrawlStatusRecord {
  targetId: string;
  status: TargetSitemapCrawlStatus;
  startedAt: string | null;
  completedAt: string | null;
  failedAt: string | null;
  errorMessage: string | null;
  updatedAt: string | null;
}

export type AuthenticatedSitemapCrawlStatus =
  | "idle"
  | "running"
  | "paused"
  | "completed"
  | "authentication_required"
  | "failed";

export type SitemapCrawlerType = "public" | "authenticated";

export type SitemapCrawlFailureKind = "timeout" | "http" | "network";

export interface SitemapCrawlFrontierEntry {
  url: string;
  depth: number;
  source: TargetSitemapEntrySource;
}

export interface SitemapCrawlFailure extends SitemapCrawlFrontierEntry {
  kind: SitemapCrawlFailureKind;
  httpStatus: number | null;
  errorMessage: string;
}

export interface SitemapCrawlCheckpoint {
  crawlerType: SitemapCrawlerType;
  ownerId: string;
  targetId: string;
  rootUrl: string;
  frontier: SitemapCrawlFrontierEntry[];
  visitedUrls: string[];
  failures: SitemapCrawlFailure[];
  discoveredEntryKeys: string[];
  pagesFetched: number;
  entriesDiscovered: number;
  updatedAt: string;
}

export type SitemapCrawlRunMode = "fresh" | "resume" | "retry_failures";

export interface AuthenticatedSitemapCrawlStatusRecord {
  sessionId: string;
  targetId: string;
  status: AuthenticatedSitemapCrawlStatus;
  startedAt: string | null;
  completedAt: string | null;
  pausedAt: string | null;
  failedAt: string | null;
  errorMessage: string | null;
  updatedAt: string | null;
}

export interface AuthenticatedSitemapAccessObservationInput {
  sessionId: string;
  targetId: string;
  entryId: string;
  httpStatus: number;
}

export interface AuthenticatedSitemapAccessObservationRecord
  extends AuthenticatedSitemapAccessObservationInput {
  observedAt: string;
}
