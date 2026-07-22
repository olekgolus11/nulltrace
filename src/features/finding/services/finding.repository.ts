import { Database } from "bun:sqlite";
import {
  FindingReviewStatus,
  SetFindingReviewStatusInput,
  SessionFindingRecord,
  UpsertFindingCandidateInput,
} from "../model/finding.types";
import { sessionDatabase } from "../../session/services/session-database";
import { createFindingFingerprint } from "./finding-fingerprint";
import {
  CanonicalFindingSeverity,
  maxFindingSeverity,
  normalizeFindingSeverity,
} from "./finding-severity";

interface SessionFindingRow {
  id: string;
  sessionId: string;
  toolRunArtifactId: string;
  sourceTool: string;
  kind: string;
  severity: string;
  title: string;
  summary: string;
  target: string;
  fingerprint: string;
  payloadJson: string;
  reviewStatus: string | null;
  reviewUpdatedAt: string | null;
  firstSeenAt: string;
  lastSeenAt: string;
  createdAt: string;
}

const findingReviewStatuses: FindingReviewStatus[] = ["needs_review", "confirmed", "dismissed"];

function createTimestamp() {
  return new Date().toISOString();
}

function createId() {
  return crypto.randomUUID();
}

function parseJsonPayload(value: string) {
  try {
    return JSON.parse(value);
  } catch {
    return value;
  }
}

function normalizeFindingReviewStatus(value: string | null): FindingReviewStatus {
  if (value && findingReviewStatuses.includes(value as FindingReviewStatus)) {
    return value as FindingReviewStatus;
  }

  return "needs_review";
}

function mapFindingRow(row: SessionFindingRow): SessionFindingRecord {
  return {
    id: row.id,
    sessionId: row.sessionId,
    toolRunArtifactId: row.toolRunArtifactId,
    sourceTool: row.sourceTool,
    kind: row.kind,
    severity: normalizeFindingSeverity(row.severity),
    title: row.title,
    summary: row.summary,
    target: row.target,
    fingerprint: row.fingerprint,
    payload: parseJsonPayload(row.payloadJson),
    reviewStatus: normalizeFindingReviewStatus(row.reviewStatus),
    reviewUpdatedAt: row.reviewUpdatedAt,
    firstSeenAt: row.firstSeenAt,
    lastSeenAt: row.lastSeenAt,
    createdAt: row.createdAt,
  };
}

export class FindingRepository {
  constructor(private readonly database: Database = sessionDatabase) {}

  upsertCandidates(inputs: UpsertFindingCandidateInput[]) {
    const records = inputs.map((input) => this.upsertCandidate(input));
    const sessionIds = [...new Set(inputs.map((input) => input.sessionId))];

    sessionIds.forEach((sessionId) => {
      this.touchSessionActivity(sessionId);
    });

    return records;
  }

  listBySessionId(sessionId: string) {
    return this.database
      .query<SessionFindingRow, [string]>(
        `SELECT
          id,
          session_id AS sessionId,
          tool_run_artifact_id AS toolRunArtifactId,
          source_tool AS sourceTool,
          kind,
          severity,
          title,
          summary,
          target,
          fingerprint,
          payload_json AS payloadJson,
          finding_reviews.review_status AS reviewStatus,
          finding_reviews.updated_at AS reviewUpdatedAt,
          first_seen_at AS firstSeenAt,
          last_seen_at AS lastSeenAt,
          created_at AS createdAt
        FROM session_findings
        LEFT JOIN finding_reviews
          ON finding_reviews.finding_id = session_findings.id
        WHERE session_id = ?1
        ORDER BY
          CASE severity
            WHEN 'critical' THEN 5
            WHEN 'high' THEN 4
            WHEN 'medium' THEN 3
            WHEN 'low' THEN 2
            ELSE 1
          END DESC,
          last_seen_at DESC`,
      )
      .all(sessionId)
      .map(mapFindingRow);
  }

  setReviewStatus({ findingId, reviewStatus }: SetFindingReviewStatusInput) {
    const timestamp = createTimestamp();

    this.database
      .query(
        `INSERT INTO finding_reviews (
          finding_id,
          review_status,
          updated_at
        ) VALUES (?1, ?2, ?3)
        ON CONFLICT(finding_id) DO UPDATE SET
          review_status = excluded.review_status,
          updated_at = excluded.updated_at`,
      )
      .run(findingId, reviewStatus, timestamp);

    return this.findById(findingId);
  }

  private upsertCandidate({
    sessionId,
    toolRunArtifactId,
    candidate,
  }: UpsertFindingCandidateInput) {
    const fingerprint = createFindingFingerprint(
      candidate.sourceTool,
      candidate.kind,
      candidate.dedupeKeyParts,
    );
    const nextSeverity = normalizeFindingSeverity(candidate.severity);
    const timestamp = createTimestamp();
    const existing = this.findByFingerprint(sessionId, fingerprint);

    if (!existing) {
      const record: SessionFindingRecord = {
        id: createId(),
        sessionId,
        toolRunArtifactId,
        sourceTool: candidate.sourceTool,
        kind: candidate.kind,
        severity: nextSeverity,
        title: candidate.title,
        summary: candidate.summary,
        target: candidate.target,
        fingerprint,
        payload: candidate.payload,
        reviewStatus: "needs_review",
        reviewUpdatedAt: null,
        firstSeenAt: timestamp,
        lastSeenAt: timestamp,
        createdAt: timestamp,
      };

      this.database
        .query(
          `INSERT INTO session_findings (
            id,
            session_id,
            tool_run_artifact_id,
            source_tool,
            kind,
            severity,
            title,
            summary,
            target,
            fingerprint,
            payload_json,
            first_seen_at,
            last_seen_at,
            created_at
          ) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12, ?13, ?14)`,
        )
        .run(
          record.id,
          record.sessionId,
          record.toolRunArtifactId,
          record.sourceTool,
          record.kind,
          record.severity,
          record.title,
          record.summary,
          record.target,
          record.fingerprint,
          JSON.stringify(record.payload),
          record.firstSeenAt,
          record.lastSeenAt,
          record.createdAt,
        );

      return record;
    }

    const preservedSeverity = maxFindingSeverity(existing.severity, nextSeverity);

    this.database
      .query(
        `UPDATE session_findings
         SET tool_run_artifact_id = ?2,
             severity = ?3,
             title = ?4,
             summary = ?5,
             target = ?6,
             payload_json = ?7,
             last_seen_at = ?8
         WHERE id = ?1`,
      )
      .run(
        existing.id,
        toolRunArtifactId,
        preservedSeverity,
        candidate.title,
        candidate.summary,
        candidate.target,
        JSON.stringify(candidate.payload),
        timestamp,
      );

    return {
      ...existing,
      toolRunArtifactId,
      severity: preservedSeverity,
      title: candidate.title,
      summary: candidate.summary,
      target: candidate.target,
      payload: candidate.payload,
      lastSeenAt: timestamp,
    };
  }

  private findByFingerprint(sessionId: string, fingerprint: string) {
    const row = this.database
      .query<SessionFindingRow, [string, string]>(
        `SELECT
          id,
          session_id AS sessionId,
          tool_run_artifact_id AS toolRunArtifactId,
          source_tool AS sourceTool,
          kind,
          severity,
          title,
          summary,
          target,
          fingerprint,
          payload_json AS payloadJson,
          finding_reviews.review_status AS reviewStatus,
          finding_reviews.updated_at AS reviewUpdatedAt,
          first_seen_at AS firstSeenAt,
          last_seen_at AS lastSeenAt,
          created_at AS createdAt
        FROM session_findings
        LEFT JOIN finding_reviews
          ON finding_reviews.finding_id = session_findings.id
        WHERE session_id = ?1
          AND fingerprint = ?2`,
      )
      .get(sessionId, fingerprint);

    return row ? mapFindingRow(row) : null;
  }

  private findById(findingId: string) {
    const row = this.database
      .query<SessionFindingRow, [string]>(
        `SELECT
          session_findings.id AS id,
          session_id AS sessionId,
          tool_run_artifact_id AS toolRunArtifactId,
          source_tool AS sourceTool,
          kind,
          severity,
          title,
          summary,
          target,
          fingerprint,
          payload_json AS payloadJson,
          finding_reviews.review_status AS reviewStatus,
          finding_reviews.updated_at AS reviewUpdatedAt,
          first_seen_at AS firstSeenAt,
          last_seen_at AS lastSeenAt,
          created_at AS createdAt
        FROM session_findings
        LEFT JOIN finding_reviews
          ON finding_reviews.finding_id = session_findings.id
        WHERE session_findings.id = ?1`,
      )
      .get(findingId);

    return row ? mapFindingRow(row) : null;
  }

  private touchSessionActivity(sessionId: string) {
    this.database
      .query(
        `UPDATE sessions
         SET last_activity_at = ?2
         WHERE id = ?1`,
      )
      .run(sessionId, createTimestamp());
  }
}

export const findingRepository = new FindingRepository();
