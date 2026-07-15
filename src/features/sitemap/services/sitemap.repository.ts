import { Database } from "bun:sqlite";
import { sessionDatabase } from "../../session/services/session-database";
import {
  AuthenticatedSitemapAccessObservationInput,
  AuthenticatedSitemapAccessObservationRecord,
  AuthenticatedSitemapCrawlStatus,
  AuthenticatedSitemapCrawlStatusRecord,
  SitemapCrawlCheckpoint,
  SitemapCrawlFailure,
  SitemapCrawlFrontierEntry,
  SitemapCrawlerType,
  TargetSitemapCrawlStatus,
  TargetSitemapCrawlStatusRecord,
  TargetSitemapDiscoveryProvenance,
  TargetSitemapEntryListFilters,
  TargetSitemapEntryListResult,
  TargetSitemapEntryRecord,
  TargetSitemapEntrySource,
  UpsertTargetSitemapEntryInput,
} from "../model/sitemap.types";

interface TargetSitemapEntryRow {
  id: string;
  targetId: string;
  normalizedUrl: string;
  path: string;
  method: string | null;
  httpStatus: number | null;
  source: string;
  provenance: string;
  depth: number;
  firstSeenAt: string;
  lastSeenAt: string;
  createdAt: string;
}

interface TargetSitemapCrawlStatusRow {
  targetId: string;
  status: string;
  startedAt: string | null;
  completedAt: string | null;
  failedAt: string | null;
  errorMessage: string | null;
  updatedAt: string;
}

interface AuthenticatedSitemapAccessObservationRow {
  sessionId: string;
  targetId: string;
  entryId: string;
  httpStatus: number;
  observedAt: string;
}

interface AuthenticatedSitemapCrawlStatusRow {
  sessionId: string;
  targetId: string;
  status: string;
  startedAt: string | null;
  completedAt: string | null;
  pausedAt: string | null;
  failedAt: string | null;
  errorMessage: string | null;
  updatedAt: string;
}

interface SitemapCrawlCheckpointRow {
  crawlerType: string;
  ownerId: string;
  targetId: string;
  rootUrl: string;
  frontierJson: string;
  visitedUrlsJson: string;
  failuresJson: string;
  pagesFetched: number;
  entriesDiscovered: number;
  updatedAt: string;
}

export type SaveSitemapCrawlCheckpointInput = Omit<
  SitemapCrawlCheckpoint,
  "updatedAt"
>;

const crawlStatuses: TargetSitemapCrawlStatus[] = [
  "idle",
  "running",
  "paused",
  "completed",
  "failed",
];

const entrySources: TargetSitemapEntrySource[] = [
  "seed",
  "html_link",
  "html_form",
  "sitemap_xml",
  "robots_sitemap",
  "manual",
];

const discoveryProvenances: TargetSitemapDiscoveryProvenance[] = [
  "public",
  "authenticated",
  "both",
];

const authenticatedCrawlStatuses: AuthenticatedSitemapCrawlStatus[] = [
  "idle",
  "running",
  "paused",
  "completed",
  "authentication_required",
  "failed",
];

function createTimestamp() {
  return new Date().toISOString();
}

function createId() {
  return crypto.randomUUID();
}

function normalizeMethod(method: string | null | undefined) {
  return method ? method.toUpperCase() : null;
}

function normalizeLimit(limit: number | undefined) {
  if (!limit || !Number.isFinite(limit)) {
    return 100;
  }

  return Math.max(1, Math.min(Math.trunc(limit), 500));
}

function normalizeOffset(offset: number | undefined) {
  if (!offset || !Number.isFinite(offset)) {
    return 0;
  }

  return Math.max(0, Math.trunc(offset));
}

function escapeLikePattern(value: string) {
  return value.replace(/[\\%_]/g, "\\$&");
}

function normalizeEntrySource(value: string): TargetSitemapEntrySource {
  if (entrySources.includes(value as TargetSitemapEntrySource)) {
    return value as TargetSitemapEntrySource;
  }

  return "manual";
}

function normalizeCrawlStatus(value: string): TargetSitemapCrawlStatus {
  if (crawlStatuses.includes(value as TargetSitemapCrawlStatus)) {
    return value as TargetSitemapCrawlStatus;
  }

  return "idle";
}

function normalizeProvenance(value: string): TargetSitemapDiscoveryProvenance {
  return discoveryProvenances.includes(value as TargetSitemapDiscoveryProvenance)
    ? (value as TargetSitemapDiscoveryProvenance)
    : "public";
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isCheckpointFrontierEntry(
  value: unknown,
): value is SitemapCrawlFrontierEntry {
  return isRecord(value) &&
    typeof value.url === "string" &&
    typeof value.depth === "number" &&
    typeof value.source === "string" &&
    entrySources.some((source) => source === value.source);
}

function isCheckpointFailure(value: unknown): value is SitemapCrawlFailure {
  return isRecord(value) &&
    isCheckpointFrontierEntry(value) &&
    (value.kind === "timeout" ||
      value.kind === "http" ||
      value.kind === "network") &&
    (value.httpStatus === null || typeof value.httpStatus === "number") &&
    typeof value.errorMessage === "string";
}

function parseCheckpointArray<T>(
  value: string,
  isItem: (item: unknown) => item is T,
): T[] | null {
  try {
    const parsed: unknown = JSON.parse(value);
    return Array.isArray(parsed) && parsed.every(isItem) ? parsed : null;
  } catch {
    return null;
  }
}

function parseCheckpointFrontier(value: string) {
  try {
    const parsed: unknown = JSON.parse(value);
    if (Array.isArray(parsed) && parsed.every(isCheckpointFrontierEntry)) {
      return {
        frontier: parsed,
        discoveredEntryKeys: [],
      };
    }
    if (!isRecord(parsed)) {
      return null;
    }
    const frontier = parsed.frontier;
    const discoveredEntryKeys = parsed.discoveredEntryKeys;
    if (
      !Array.isArray(frontier) ||
      !frontier.every(isCheckpointFrontierEntry) ||
      !Array.isArray(discoveredEntryKeys) ||
      !discoveredEntryKeys.every((entry) => typeof entry === "string")
    ) {
      return null;
    }
    return { frontier, discoveredEntryKeys };
  } catch {
    return null;
  }
}

function mergeProvenance(
  existing: TargetSitemapDiscoveryProvenance,
  incoming: Exclude<TargetSitemapDiscoveryProvenance, "both">,
): TargetSitemapDiscoveryProvenance {
  return existing === incoming ? existing : "both";
}

function mapEntryRow(row: TargetSitemapEntryRow): TargetSitemapEntryRecord {
  return {
    id: row.id,
    targetId: row.targetId,
    normalizedUrl: row.normalizedUrl,
    path: row.path,
    method: row.method,
    httpStatus: row.httpStatus,
    source: normalizeEntrySource(row.source),
    provenance: normalizeProvenance(row.provenance),
    depth: row.depth,
    firstSeenAt: row.firstSeenAt,
    lastSeenAt: row.lastSeenAt,
    createdAt: row.createdAt,
  };
}

function mapCrawlStatusRow(
  row: TargetSitemapCrawlStatusRow,
): TargetSitemapCrawlStatusRecord {
  return {
    targetId: row.targetId,
    status: normalizeCrawlStatus(row.status),
    startedAt: row.startedAt,
    completedAt: row.completedAt,
    failedAt: row.failedAt,
    errorMessage: row.errorMessage,
    updatedAt: row.updatedAt,
  };
}

function createIdleCrawlStatus(targetId: string): TargetSitemapCrawlStatusRecord {
  return {
    targetId,
    status: "idle",
    startedAt: null,
    completedAt: null,
    failedAt: null,
    errorMessage: null,
    updatedAt: null,
  };
}

export class SitemapRepository {
  constructor(private readonly database: Database = sessionDatabase) {}

  upsertEntry(input: UpsertTargetSitemapEntryInput) {
    const method = normalizeMethod(input.method);
    const existing = this.findEntryByNormalizedUrl(
      input.targetId,
      input.normalizedUrl,
      method,
    );
    const timestamp = createTimestamp();

    if (!existing) {
      const record: TargetSitemapEntryRecord = {
        id: createId(),
        targetId: input.targetId,
        normalizedUrl: input.normalizedUrl,
        path: input.path,
        method,
        httpStatus: input.httpStatus ?? null,
        source: input.source,
        provenance: input.provenance ?? "public",
        depth: input.depth,
        firstSeenAt: timestamp,
        lastSeenAt: timestamp,
        createdAt: timestamp,
      };

      this.database
        .query(
          `INSERT INTO target_sitemap_entries (
            id,
            target_id,
            normalized_url,
            path,
            method,
            http_status,
            source,
            provenance,
            depth,
            first_seen_at,
            last_seen_at,
            created_at
          ) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12)`,
        )
        .run(
          record.id,
          record.targetId,
          record.normalizedUrl,
          record.path,
          record.method,
          record.httpStatus,
          record.source,
          record.provenance,
          record.depth,
          record.firstSeenAt,
          record.lastSeenAt,
          record.createdAt,
        );

      return record;
    }

    const nextDepth = Math.min(existing.depth, input.depth);
    const nextHttpStatus = input.httpStatus ?? existing.httpStatus;
    const nextProvenance = mergeProvenance(
      existing.provenance,
      input.provenance ?? "public",
    );

    this.database
      .query(
        `UPDATE target_sitemap_entries
         SET path = ?2,
             http_status = ?3,
             source = ?4,
             provenance = ?5,
             depth = ?6,
             last_seen_at = ?7
         WHERE id = ?1`,
      )
      .run(
        existing.id,
        input.path,
        nextHttpStatus,
        input.source,
        nextProvenance,
        nextDepth,
        timestamp,
      );

    return {
      ...existing,
      path: input.path,
      httpStatus: nextHttpStatus,
      source: input.source,
      provenance: nextProvenance,
      depth: nextDepth,
      lastSeenAt: timestamp,
    };
  }

  listEntries(filters: TargetSitemapEntryListFilters): TargetSitemapEntryListResult {
    const limit = normalizeLimit(filters.limit);
    const offset = normalizeOffset(filters.offset);
    const clauses = ["target_id = ?1"];
    const params: Array<string | number> = [filters.targetId];

    if (filters.depth !== undefined) {
      params.push(filters.depth);
      clauses.push(`depth = ?${params.length}`);
    }

    if (filters.maxDepth !== undefined) {
      params.push(filters.maxDepth);
      clauses.push(`depth <= ?${params.length}`);
    }

    if (filters.path) {
      params.push(`%${escapeLikePattern(filters.path.toLowerCase())}%`);
      clauses.push(`LOWER(path) LIKE ?${params.length} ESCAPE '\\'`);
    }

    if (filters.method) {
      params.push(filters.method.toUpperCase());
      clauses.push(`method = ?${params.length}`);
    }

    if (filters.httpStatus !== undefined) {
      params.push(filters.httpStatus);
      clauses.push(`http_status = ?${params.length}`);
    }

    if (filters.source) {
      params.push(filters.source);
      clauses.push(`source = ?${params.length}`);
    }

    if (filters.provenance) {
      params.push(filters.provenance);
      clauses.push(`provenance = ?${params.length}`);
    }

    if (
      filters.hasAccessObservation !== undefined &&
      filters.accessObservedBySessionId
    ) {
      params.push(filters.accessObservedBySessionId);
      clauses.push(
        `${filters.hasAccessObservation ? "" : "NOT "}EXISTS (
          SELECT 1
          FROM authenticated_sitemap_access_observations AS access_observation
          WHERE access_observation.entry_id = target_sitemap_entries.id
            AND access_observation.session_id = ?${params.length}
        )`,
      );
    }

    const whereClause = clauses.join(" AND ");
    const total = this.database
      .query<{ count: number }, Array<string | number>>(
        `SELECT COUNT(*) AS count
         FROM target_sitemap_entries
         WHERE ${whereClause}`,
      )
      .get(...params)?.count ?? 0;

    const entries = this.database
      .query<TargetSitemapEntryRow, Array<string | number>>(
        `SELECT
          id,
          target_id AS targetId,
          normalized_url AS normalizedUrl,
          path,
          method,
          http_status AS httpStatus,
          source,
          provenance,
          depth,
          first_seen_at AS firstSeenAt,
          last_seen_at AS lastSeenAt,
          created_at AS createdAt
        FROM target_sitemap_entries
        WHERE ${whereClause}
        ORDER BY depth ASC, path ASC, COALESCE(method, '') ASC
        LIMIT ?${params.length + 1}
        OFFSET ?${params.length + 2}`,
      )
      .all(...params, limit, offset)
      .map(mapEntryRow);

    return {
      entries,
      total,
      limit,
      offset,
    };
  }

  getCrawlStatus(targetId: string) {
    const row = this.database
      .query<TargetSitemapCrawlStatusRow, [string]>(
        `SELECT
          target_id AS targetId,
          status,
          started_at AS startedAt,
          completed_at AS completedAt,
          failed_at AS failedAt,
          error_message AS errorMessage,
          updated_at AS updatedAt
        FROM target_sitemap_crawl_statuses
        WHERE target_id = ?1`,
      )
      .get(targetId);

    return row ? mapCrawlStatusRow(row) : createIdleCrawlStatus(targetId);
  }

  findEntryByIdForTarget(targetId: string, entryId: string) {
    const row = this.database
      .query<TargetSitemapEntryRow, [string, string]>(
        `SELECT
          id,
          target_id AS targetId,
          normalized_url AS normalizedUrl,
          path,
          method,
          http_status AS httpStatus,
          source,
          provenance,
          depth,
          first_seen_at AS firstSeenAt,
          last_seen_at AS lastSeenAt,
          created_at AS createdAt
        FROM target_sitemap_entries
        WHERE target_id = ?1 AND id = ?2`,
      )
      .get(targetId, entryId);

    return row ? mapEntryRow(row) : null;
  }

  markCrawlRunning(targetId: string) {
    const timestamp = createTimestamp();

    this.database
      .query(
        `INSERT INTO target_sitemap_crawl_statuses (
          target_id,
          status,
          started_at,
          completed_at,
          failed_at,
          error_message,
          updated_at
        ) VALUES (?1, 'running', ?2, NULL, NULL, NULL, ?2)
        ON CONFLICT(target_id) DO UPDATE SET
          status = 'running',
          started_at = excluded.started_at,
          completed_at = NULL,
          failed_at = NULL,
          error_message = NULL,
          updated_at = excluded.updated_at`,
      )
      .run(targetId, timestamp);

    return this.getCrawlStatus(targetId);
  }

  markCrawlCompleted(targetId: string) {
    const timestamp = createTimestamp();

    this.database
      .query(
        `INSERT INTO target_sitemap_crawl_statuses (
          target_id,
          status,
          started_at,
          completed_at,
          failed_at,
          error_message,
          updated_at
        ) VALUES (?1, 'completed', NULL, ?2, NULL, NULL, ?2)
        ON CONFLICT(target_id) DO UPDATE SET
          status = 'completed',
          completed_at = excluded.completed_at,
          failed_at = NULL,
          error_message = NULL,
          updated_at = excluded.updated_at`,
      )
      .run(targetId, timestamp);

    return this.getCrawlStatus(targetId);
  }

  markCrawlPaused(targetId: string) {
    const timestamp = createTimestamp();
    this.database
      .query(
        `UPDATE target_sitemap_crawl_statuses
         SET status = 'paused', completed_at = NULL, failed_at = NULL,
             error_message = NULL, updated_at = ?2
         WHERE target_id = ?1`,
      )
      .run(targetId, timestamp);
    return this.getCrawlStatus(targetId);
  }

  markCrawlFailed(targetId: string, errorMessage: string) {
    const timestamp = createTimestamp();

    this.database
      .query(
        `INSERT INTO target_sitemap_crawl_statuses (
          target_id,
          status,
          started_at,
          completed_at,
          failed_at,
          error_message,
          updated_at
        ) VALUES (?1, 'failed', NULL, NULL, ?2, ?3, ?2)
        ON CONFLICT(target_id) DO UPDATE SET
          status = 'failed',
          completed_at = NULL,
          failed_at = excluded.failed_at,
          error_message = excluded.error_message,
          updated_at = excluded.updated_at`,
      )
      .run(targetId, timestamp, errorMessage);

    return this.getCrawlStatus(targetId);
  }

  upsertAccessObservation(input: AuthenticatedSitemapAccessObservationInput) {
    const observedAt = createTimestamp();
    this.database
      .query(
        `INSERT INTO authenticated_sitemap_access_observations (
          session_id, target_id, entry_id, http_status, observed_at
        ) VALUES (?1, ?2, ?3, ?4, ?5)
        ON CONFLICT(session_id, entry_id) DO UPDATE SET
          http_status = excluded.http_status,
          observed_at = excluded.observed_at`,
      )
      .run(
        input.sessionId,
        input.targetId,
        input.entryId,
        input.httpStatus,
        observedAt,
      );
    return { ...input, observedAt };
  }

  listAccessObservations(
    sessionId: string,
  ): AuthenticatedSitemapAccessObservationRecord[] {
    return this.database
      .query<AuthenticatedSitemapAccessObservationRow, [string]>(
        `SELECT session_id AS sessionId, target_id AS targetId,
          entry_id AS entryId, http_status AS httpStatus,
          observed_at AS observedAt
         FROM authenticated_sitemap_access_observations
         WHERE session_id = ?1
         ORDER BY observed_at ASC`,
      )
      .all(sessionId);
  }

  getAuthenticatedCrawlStatus(sessionId: string, targetId: string) {
    const row = this.database
      .query<AuthenticatedSitemapCrawlStatusRow, [string]>(
        `SELECT session_id AS sessionId, target_id AS targetId, status,
          started_at AS startedAt, completed_at AS completedAt,
          paused_at AS pausedAt, failed_at AS failedAt,
          error_message AS errorMessage, updated_at AS updatedAt
         FROM authenticated_sitemap_crawl_statuses
         WHERE session_id = ?1`,
      )
      .get(sessionId);
    if (!row) {
      return {
        sessionId,
        targetId,
        status: "idle",
        startedAt: null,
        completedAt: null,
        pausedAt: null,
        failedAt: null,
        errorMessage: null,
        updatedAt: null,
      } satisfies AuthenticatedSitemapCrawlStatusRecord;
    }
    return {
      ...row,
      status: authenticatedCrawlStatuses.includes(
        row.status as AuthenticatedSitemapCrawlStatus,
      )
        ? (row.status as AuthenticatedSitemapCrawlStatus)
        : "idle",
    };
  }

  markAuthenticatedCrawlRunning(sessionId: string, targetId: string) {
    return this.writeAuthenticatedCrawlStatus(
      sessionId,
      targetId,
      "running",
      null,
    );
  }

  markAuthenticatedCrawlCompleted(sessionId: string, targetId: string) {
    return this.writeAuthenticatedCrawlStatus(
      sessionId,
      targetId,
      "completed",
      null,
    );
  }

  markAuthenticatedCrawlPaused(sessionId: string, targetId: string) {
    return this.writeAuthenticatedCrawlStatus(
      sessionId,
      targetId,
      "paused",
      null,
    );
  }

  saveCrawlCheckpoint(input: SaveSitemapCrawlCheckpointInput) {
    const updatedAt = createTimestamp();
    this.database
      .query(
        `INSERT INTO sitemap_crawl_checkpoints (
          crawler_type, owner_id, target_id, root_url, frontier_json,
          visited_urls_json, failures_json, pages_fetched,
          entries_discovered, updated_at
        ) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10)
        ON CONFLICT(crawler_type, owner_id) DO UPDATE SET
          target_id = excluded.target_id,
          root_url = excluded.root_url,
          frontier_json = excluded.frontier_json,
          visited_urls_json = excluded.visited_urls_json,
          failures_json = excluded.failures_json,
          pages_fetched = excluded.pages_fetched,
          entries_discovered = excluded.entries_discovered,
          updated_at = excluded.updated_at`,
      )
      .run(
        input.crawlerType,
        input.ownerId,
        input.targetId,
        input.rootUrl,
        JSON.stringify({
          frontier: input.frontier,
          discoveredEntryKeys: input.discoveredEntryKeys,
        }),
        JSON.stringify(input.visitedUrls),
        JSON.stringify(input.failures),
        input.pagesFetched,
        input.entriesDiscovered,
        updatedAt,
      );
    return this.getCrawlCheckpoint(input.crawlerType, input.ownerId);
  }

  getCrawlCheckpoint(
    crawlerType: SitemapCrawlerType,
    ownerId: string,
  ): SitemapCrawlCheckpoint | null {
    const row = this.database
      .query<SitemapCrawlCheckpointRow, [string, string]>(
        `SELECT crawler_type AS crawlerType, owner_id AS ownerId,
          target_id AS targetId, root_url AS rootUrl,
          frontier_json AS frontierJson, visited_urls_json AS visitedUrlsJson,
          failures_json AS failuresJson, pages_fetched AS pagesFetched,
          entries_discovered AS entriesDiscovered, updated_at AS updatedAt
         FROM sitemap_crawl_checkpoints
         WHERE crawler_type = ?1 AND owner_id = ?2`,
      )
      .get(crawlerType, ownerId);
    if (!row) {
      return null;
    }
    const checkpointFrontier = parseCheckpointFrontier(row.frontierJson);
    const visitedUrls = parseCheckpointArray(
      row.visitedUrlsJson,
      (value): value is string => typeof value === "string",
    );
    const failures = parseCheckpointArray(
      row.failuresJson,
      isCheckpointFailure,
    );
    if (!checkpointFrontier || !visitedUrls || !failures) {
      return null;
    }
    return {
      crawlerType,
      ownerId: row.ownerId,
      targetId: row.targetId,
      rootUrl: row.rootUrl,
      frontier: checkpointFrontier.frontier,
      visitedUrls,
      failures,
      discoveredEntryKeys: checkpointFrontier.discoveredEntryKeys,
      pagesFetched: row.pagesFetched,
      entriesDiscovered: row.entriesDiscovered,
      updatedAt: row.updatedAt,
    };
  }

  deleteCrawlCheckpoint(crawlerType: SitemapCrawlerType, ownerId: string) {
    this.database
      .query(
        `DELETE FROM sitemap_crawl_checkpoints
         WHERE crawler_type = ?1 AND owner_id = ?2`,
      )
      .run(crawlerType, ownerId);
  }

  recoverInterruptedCrawls() {
    const timestamp = createTimestamp();
    this.database
      .query(
        `UPDATE target_sitemap_crawl_statuses
         SET status = 'paused', updated_at = ?1
         WHERE status IN ('running', 'paused')`,
      )
      .run(timestamp);
    this.database
      .query(
        `UPDATE authenticated_sitemap_crawl_statuses
         SET status = 'authentication_required', paused_at = ?1,
             error_message = ?2, updated_at = ?1
         WHERE status IN ('running', 'paused')`,
      )
      .run(
        timestamp,
        "Run Auth Check again to resume after application restart.",
      );
  }

  markAuthenticatedCrawlAuthenticationRequired(
    sessionId: string,
    targetId: string,
    errorMessage: string,
  ) {
    return this.writeAuthenticatedCrawlStatus(
      sessionId,
      targetId,
      "authentication_required",
      errorMessage,
    );
  }

  markAuthenticatedCrawlFailed(
    sessionId: string,
    targetId: string,
    errorMessage: string,
  ) {
    return this.writeAuthenticatedCrawlStatus(
      sessionId,
      targetId,
      "failed",
      errorMessage,
    );
  }

  private writeAuthenticatedCrawlStatus(
    sessionId: string,
    targetId: string,
    status: Exclude<AuthenticatedSitemapCrawlStatus, "idle">,
    errorMessage: string | null,
  ) {
    const timestamp = createTimestamp();
    const completedAt = status === "completed" ? timestamp : null;
    const pausedAt =
      status === "authentication_required" || status === "paused"
        ? timestamp
        : null;
    const failedAt = status === "failed" ? timestamp : null;
    this.database
      .query(
        `INSERT INTO authenticated_sitemap_crawl_statuses (
          session_id, target_id, status, started_at, completed_at,
          paused_at, failed_at, error_message, updated_at
        ) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?4)
        ON CONFLICT(session_id) DO UPDATE SET
          target_id = excluded.target_id,
          status = excluded.status,
          started_at = CASE
            WHEN excluded.status = 'running' THEN excluded.started_at
            ELSE started_at
          END,
          completed_at = excluded.completed_at,
          paused_at = excluded.paused_at,
          failed_at = excluded.failed_at,
          error_message = excluded.error_message,
          updated_at = excluded.updated_at`,
      )
      .run(
        sessionId,
        targetId,
        status,
        timestamp,
        completedAt,
        pausedAt,
        failedAt,
        errorMessage,
      );
    return this.getAuthenticatedCrawlStatus(sessionId, targetId);
  }

  private findEntryByNormalizedUrl(
    targetId: string,
    normalizedUrl: string,
    method: string | null,
  ) {
    const row = this.database
      .query<TargetSitemapEntryRow, [string, string, string]>(
        `SELECT
          id,
          target_id AS targetId,
          normalized_url AS normalizedUrl,
          path,
          method,
          http_status AS httpStatus,
          source,
          provenance,
          depth,
          first_seen_at AS firstSeenAt,
          last_seen_at AS lastSeenAt,
          created_at AS createdAt
        FROM target_sitemap_entries
        WHERE target_id = ?1
          AND normalized_url = ?2
          AND COALESCE(method, '') = ?3`,
      )
      .get(targetId, normalizedUrl, method ?? "");

    return row ? mapEntryRow(row) : null;
  }
}

export const sitemapRepository = new SitemapRepository();
