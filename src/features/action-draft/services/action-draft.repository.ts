import { Database } from "bun:sqlite";
import {
  ActionDraftInput,
  ActionDraftRecord,
  ActionDraftStatus,
  SetActionDraftStatusInput,
} from "../model/action-draft.types";
import {
  ScannerToolId,
  scannerCatalog,
} from "../../tool/shared/registry/scanner-catalog";

interface ActionDraftRow {
  id: string;
  sessionId: string;
  opencodeConversationId: string | null;
  targetTool: ScannerToolId;
  status: ActionDraftStatus;
  title: string;
  summary: string;
  payloadJson: string;
  createdAt: string;
  updatedAt: string;
}

const actionDraftStatuses: ActionDraftStatus[] = [
  "draft",
  "applied",
  "dismissed",
  "superseded",
];

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

function mapActionDraftRow(row: ActionDraftRow): ActionDraftRecord {
  return {
    id: row.id,
    sessionId: row.sessionId,
    opencodeConversationId: row.opencodeConversationId,
    targetTool: row.targetTool,
    status: row.status,
    title: row.title,
    summary: row.summary,
    payload: parseJsonPayload(row.payloadJson),
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}

function assertImplementedScannerTool(targetTool: ScannerToolId) {
  const scanner = scannerCatalog[targetTool];

  if (!scanner?.isImplemented) {
    throw new Error(
      `Action drafts can only target implemented scanner tools: ${targetTool}`,
    );
  }
}

function assertActionDraftStatus(status: ActionDraftStatus) {
  if (!actionDraftStatuses.includes(status)) {
    throw new Error(`Unsupported action draft status: ${status}`);
  }
}

export class ActionDraftRepository {
  constructor(private readonly database: Database) {}

  createDraft(input: ActionDraftInput) {
    assertImplementedScannerTool(input.targetTool);
    this.assertConversationBelongsToSession(
      input.sessionId,
      input.opencodeConversationId ?? null,
    );

    const timestamp = createTimestamp();
    const record: ActionDraftRecord = {
      id: createId(),
      sessionId: input.sessionId,
      opencodeConversationId: input.opencodeConversationId ?? null,
      targetTool: input.targetTool,
      status: "draft",
      title: input.title,
      summary: input.summary,
      payload: input.payload,
      createdAt: timestamp,
      updatedAt: timestamp,
    };

    this.database
      .query(
        `INSERT INTO action_drafts (
          id,
          session_id,
          opencode_conversation_id,
          target_tool,
          status,
          title,
          summary,
          payload_json,
          created_at,
          updated_at
        ) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10)`,
      )
      .run(
        record.id,
        record.sessionId,
        record.opencodeConversationId,
        record.targetTool,
        record.status,
        record.title,
        record.summary,
        JSON.stringify(record.payload),
        record.createdAt,
        record.updatedAt,
      );

    this.touchSessionActivity(record.sessionId);
    return record;
  }

  listBySessionId(sessionId: string) {
    return this.database
      .query<ActionDraftRow, [string]>(
        `SELECT
          id,
          session_id AS sessionId,
          opencode_conversation_id AS opencodeConversationId,
          target_tool AS targetTool,
          status,
          title,
          summary,
          payload_json AS payloadJson,
          created_at AS createdAt,
          updated_at AS updatedAt
        FROM action_drafts
        WHERE session_id = ?1
        ORDER BY created_at DESC, id DESC`,
      )
      .all(sessionId)
      .map(mapActionDraftRow);
  }

  findById(actionDraftId: string) {
    const row = this.database
      .query<ActionDraftRow, [string]>(
        `SELECT
          id,
          session_id AS sessionId,
          opencode_conversation_id AS opencodeConversationId,
          target_tool AS targetTool,
          status,
          title,
          summary,
          payload_json AS payloadJson,
          created_at AS createdAt,
          updated_at AS updatedAt
        FROM action_drafts
        WHERE id = ?1`,
      )
      .get(actionDraftId);

    return row ? mapActionDraftRow(row) : null;
  }

  setStatus({ actionDraftId, status }: SetActionDraftStatusInput) {
    assertActionDraftStatus(status);
    const timestamp = createTimestamp();

    this.database
      .query(
        `UPDATE action_drafts
         SET status = ?2,
             updated_at = ?3
         WHERE id = ?1`,
      )
      .run(actionDraftId, status, timestamp);

    const draft = this.findById(actionDraftId);
    if (draft) {
      this.touchSessionActivity(draft.sessionId);
    }

    return draft;
  }

  private assertConversationBelongsToSession(
    sessionId: string,
    opencodeConversationId: string | null,
  ) {
    if (!opencodeConversationId) {
      return;
    }

    const attachment = this.database
      .query<{ sessionId: string }, [string]>(
        `SELECT session_id AS sessionId
         FROM conversation_attachments
         WHERE opencode_conversation_id = ?1`,
      )
      .get(opencodeConversationId);

    if (!attachment || attachment.sessionId !== sessionId) {
      throw new Error(
        "Action draft conversation attribution must belong to the same session.",
      );
    }
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
