import { Database } from "bun:sqlite";
import {
  SaveSessionReportDraftInput,
  SessionReportDraftRecord,
} from "../model/session-report-draft.types";

export class SessionReportDraftRepository {
  constructor(private readonly database: Database) {}

  save(input: SaveSessionReportDraftInput): SessionReportDraftRecord {
    const existing = this.findBySessionId(input.sessionId);
    const timestamp = new Date().toISOString();
    const record: SessionReportDraftRecord = {
      id: existing?.id ?? crypto.randomUUID(),
      sessionId: input.sessionId,
      selectedFindingIds: [...new Set(input.selectedFindingIds)],
      markdown: input.markdown,
      createdAt: existing?.createdAt ?? timestamp,
      updatedAt: timestamp,
    };

    this.database
      .query(
        `INSERT INTO session_report_drafts (
          id,
          session_id,
          selected_finding_ids_json,
          markdown,
          created_at,
          updated_at
        ) VALUES (?1, ?2, ?3, ?4, ?5, ?6)
        ON CONFLICT(session_id) DO UPDATE SET
          selected_finding_ids_json = excluded.selected_finding_ids_json,
          markdown = excluded.markdown,
          updated_at = excluded.updated_at`,
      )
      .run(
        record.id,
        record.sessionId,
        JSON.stringify(record.selectedFindingIds),
        record.markdown,
        record.createdAt,
        record.updatedAt,
      );
    this.database
      .query("UPDATE sessions SET last_activity_at = ?2 WHERE id = ?1")
      .run(record.sessionId, timestamp);

    return record;
  }

  findBySessionId(sessionId: string): SessionReportDraftRecord | null {
    const row = this.database
      .query<SessionReportDraftRow, [string]>(
        `SELECT
          id,
          session_id AS sessionId,
          selected_finding_ids_json AS selectedFindingIdsJson,
          markdown,
          created_at AS createdAt,
          updated_at AS updatedAt
        FROM session_report_drafts
        WHERE session_id = ?1`,
      )
      .get(sessionId);

    return row ? this.mapRow(row) : null;
  }

  private mapRow(row: SessionReportDraftRow): SessionReportDraftRecord {
    const selectedFindingIds: unknown = JSON.parse(row.selectedFindingIdsJson);
    if (
      !Array.isArray(selectedFindingIds) ||
      !selectedFindingIds.every((findingId) => typeof findingId === "string")
    ) {
      throw new Error("Saved report draft has invalid Finding selection data.");
    }

    return {
      id: row.id,
      sessionId: row.sessionId,
      selectedFindingIds,
      markdown: row.markdown,
      createdAt: row.createdAt,
      updatedAt: row.updatedAt,
    };
  }
}

interface SessionReportDraftRow {
  id: string;
  sessionId: string;
  selectedFindingIdsJson: string;
  markdown: string;
  createdAt: string;
  updatedAt: string;
}
