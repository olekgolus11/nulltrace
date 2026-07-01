import { Database } from "bun:sqlite";
import {
  ConversationAttachmentInput,
  ConversationAttachmentRecord,
} from "../model/conversation-attachment.types";
import { sessionDatabase } from "../../session/services/session-database";

interface ConversationAttachmentRow {
  sessionId: string;
  opencodeConversationId: string;
  isDefault: number;
  archivedAt: string | null;
  createdAt: string;
}

function createTimestamp() {
  return new Date().toISOString();
}

function mapConversationAttachmentRow(
  row: ConversationAttachmentRow,
): ConversationAttachmentRecord {
  return {
    sessionId: row.sessionId,
    opencodeConversationId: row.opencodeConversationId,
    isDefault: row.isDefault === 1,
    archivedAt: row.archivedAt,
    createdAt: row.createdAt,
  };
}

export class ConversationAttachmentRepository {
  constructor(private readonly database: Database = sessionDatabase) {}

  createDefaultAttachment(input: ConversationAttachmentInput) {
    return this.createAttachmentRecord(input, true);
  }

  createAttachment(input: ConversationAttachmentInput) {
    return this.createAttachmentRecord(input, false);
  }

  listActiveBySessionId(sessionId: string) {
    return this.database
      .query<ConversationAttachmentRow, [string]>(
        `SELECT
          session_id AS sessionId,
          opencode_conversation_id AS opencodeConversationId,
          is_default AS isDefault,
          archived_at AS archivedAt,
          created_at AS createdAt
        FROM conversation_attachments
        WHERE session_id = ?1
          AND archived_at IS NULL
        ORDER BY created_at ASC, rowid ASC`,
      )
      .all(sessionId)
      .map(mapConversationAttachmentRow);
  }

  hasActiveAttachment(sessionId: string) {
    const row = this.database
      .query<{ count: number }, [string]>(
        `SELECT COUNT(*) AS count
         FROM conversation_attachments
         WHERE session_id = ?1
           AND archived_at IS NULL`,
      )
      .get(sessionId);

    return (row?.count ?? 0) > 0;
  }

  findActiveByOpenCodeConversationId(opencodeConversationId: string) {
    const row = this.database
      .query<ConversationAttachmentRow, [string]>(
        `SELECT
          session_id AS sessionId,
          opencode_conversation_id AS opencodeConversationId,
          is_default AS isDefault,
          archived_at AS archivedAt,
          created_at AS createdAt
        FROM conversation_attachments
        WHERE opencode_conversation_id = ?1
          AND archived_at IS NULL`,
      )
      .get(opencodeConversationId);

    return row ? mapConversationAttachmentRow(row) : null;
  }

  archiveAttachment(opencodeConversationId: string) {
    const timestamp = createTimestamp();

    this.database
      .query(
        `UPDATE conversation_attachments
         SET archived_at = COALESCE(archived_at, ?2)
         WHERE opencode_conversation_id = ?1`,
      )
      .run(opencodeConversationId, timestamp);

    const attachment = this.findByOpenCodeConversationId(
      opencodeConversationId,
    );
    if (attachment) {
      this.touchSessionActivity(attachment.sessionId);
    }

    return attachment;
  }

  private createAttachmentRecord(
    input: ConversationAttachmentInput,
    isDefault: boolean,
  ) {
    const record: ConversationAttachmentRecord = {
      sessionId: input.sessionId,
      opencodeConversationId: input.opencodeConversationId,
      isDefault,
      archivedAt: null,
      createdAt: createTimestamp(),
    };

    this.database
      .query(
        `INSERT INTO conversation_attachments (
          session_id,
          opencode_conversation_id,
          is_default,
          archived_at,
          created_at
        ) VALUES (?1, ?2, ?3, ?4, ?5)`,
      )
      .run(
        record.sessionId,
        record.opencodeConversationId,
        record.isDefault ? 1 : 0,
        record.archivedAt,
        record.createdAt,
      );

    this.touchSessionActivity(record.sessionId);
    return record;
  }

  private findByOpenCodeConversationId(opencodeConversationId: string) {
    const row = this.database
      .query<ConversationAttachmentRow, [string]>(
        `SELECT
          session_id AS sessionId,
          opencode_conversation_id AS opencodeConversationId,
          is_default AS isDefault,
          archived_at AS archivedAt,
          created_at AS createdAt
        FROM conversation_attachments
        WHERE opencode_conversation_id = ?1`,
      )
      .get(opencodeConversationId);

    return row ? mapConversationAttachmentRow(row) : null;
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

export const conversationAttachmentRepository =
  new ConversationAttachmentRepository();
