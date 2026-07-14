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
  | "completed"
  | "authentication_required"
  | "failed";

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
