import { Database } from "bun:sqlite";
import { sessionDatabase } from "../../session/services/session-database";
import {
  TargetSitemapCrawlStatus,
  TargetSitemapCrawlStatusRecord,
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

const crawlStatuses: TargetSitemapCrawlStatus[] = [
  "idle",
  "running",
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

function mapEntryRow(row: TargetSitemapEntryRow): TargetSitemapEntryRecord {
  return {
    id: row.id,
    targetId: row.targetId,
    normalizedUrl: row.normalizedUrl,
    path: row.path,
    method: row.method,
    httpStatus: row.httpStatus,
    source: normalizeEntrySource(row.source),
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
            depth,
            first_seen_at,
            last_seen_at,
            created_at
          ) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11)`,
        )
        .run(
          record.id,
          record.targetId,
          record.normalizedUrl,
          record.path,
          record.method,
          record.httpStatus,
          record.source,
          record.depth,
          record.firstSeenAt,
          record.lastSeenAt,
          record.createdAt,
        );

      return record;
    }

    const nextDepth = Math.min(existing.depth, input.depth);
    const nextHttpStatus = input.httpStatus ?? existing.httpStatus;

    this.database
      .query(
        `UPDATE target_sitemap_entries
         SET path = ?2,
             http_status = ?3,
             source = ?4,
             depth = ?5,
             last_seen_at = ?6
         WHERE id = ?1`,
      )
      .run(
        existing.id,
        input.path,
        nextHttpStatus,
        input.source,
        nextDepth,
        timestamp,
      );

    return {
      ...existing,
      path: input.path,
      httpStatus: nextHttpStatus,
      source: input.source,
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
