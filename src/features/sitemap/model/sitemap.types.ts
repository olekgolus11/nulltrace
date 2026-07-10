export interface SitemapNode {
  id: string;
  path: string;
  status: number;
  method?: string;
  children?: SitemapNode[];
}

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
