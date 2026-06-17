import { Database } from "bun:sqlite";
import { describe, expect, it } from "bun:test";
import { ConversationAttachmentRepository } from "../conversation-attachment.repository";
import { ConversationAttachmentService } from "../conversation-attachment.service";

function createTestDatabase() {
  const database = new Database(":memory:", {
    create: true,
    strict: true,
  });

  database.exec(`
    CREATE TABLE sessions (
      id TEXT PRIMARY KEY,
      last_activity_at TEXT NOT NULL
    );

    CREATE TABLE conversation_attachments (
      session_id TEXT NOT NULL,
      opencode_conversation_id TEXT PRIMARY KEY,
      is_default INTEGER NOT NULL CHECK (is_default IN (0, 1)),
      archived_at TEXT,
      created_at TEXT NOT NULL
    );
    CREATE INDEX idx_conversation_attachments_session_active
      ON conversation_attachments(session_id, archived_at, created_at);
    CREATE UNIQUE INDEX idx_conversation_attachments_active_default
      ON conversation_attachments(session_id)
      WHERE is_default = 1 AND archived_at IS NULL;
  `);

  database
    .query("INSERT INTO sessions (id, last_activity_at) VALUES (?1, ?2)")
    .run("session-1", "2026-05-10T10:00:00.000Z");

  return database;
}

describe("ConversationAttachmentRepository", () => {
  it("creates a default conversation attachment for a session", () => {
    const repository = new ConversationAttachmentRepository(
      createTestDatabase(),
    );

    const attachment = repository.createDefaultAttachment({
      sessionId: "session-1",
      opencodeConversationId: "opencode-1",
    });

    expect(attachment).toMatchObject({
      sessionId: "session-1",
      opencodeConversationId: "opencode-1",
      isDefault: true,
      archivedAt: null,
    });
    expect(attachment.createdAt).toBeString();
  });

  it("creates additional conversation attachments for the same session", () => {
    const repository = new ConversationAttachmentRepository(
      createTestDatabase(),
    );

    const first = repository.createDefaultAttachment({
      sessionId: "session-1",
      opencodeConversationId: "opencode-1",
    });
    const second = repository.createAttachment({
      sessionId: "session-1",
      opencodeConversationId: "opencode-2",
    });

    expect(second).toMatchObject({
      sessionId: "session-1",
      opencodeConversationId: "opencode-2",
      isDefault: false,
      archivedAt: null,
    });
    expect(second.opencodeConversationId).not.toBe(
      first.opencodeConversationId,
    );
  });

  it("lists active conversation attachments for a session", () => {
    const repository = new ConversationAttachmentRepository(
      createTestDatabase(),
    );
    const first = repository.createDefaultAttachment({
      sessionId: "session-1",
      opencodeConversationId: "opencode-1",
    });
    const second = repository.createAttachment({
      sessionId: "session-1",
      opencodeConversationId: "opencode-2",
    });

    const attachments = repository.listActiveBySessionId("session-1");

    expect(
      attachments.map((attachment) => attachment.opencodeConversationId),
    ).toEqual([first.opencodeConversationId, second.opencodeConversationId]);
  });

  it("excludes archived conversation attachments from the active list", () => {
    const repository = new ConversationAttachmentRepository(
      createTestDatabase(),
    );
    const first = repository.createDefaultAttachment({
      sessionId: "session-1",
      opencodeConversationId: "opencode-1",
    });
    const second = repository.createAttachment({
      sessionId: "session-1",
      opencodeConversationId: "opencode-2",
    });

    const archived = repository.archiveAttachment(first.opencodeConversationId);
    const activeAttachments = repository.listActiveBySessionId("session-1");

    expect(archived).toMatchObject({
      opencodeConversationId: "opencode-1",
    });
    expect(archived?.archivedAt).toBeString();
    expect(
      activeAttachments.map((attachment) => attachment.opencodeConversationId),
    ).toEqual([second.opencodeConversationId]);
  });

  it("archives only NullTrace metadata and keeps the OpenCode conversation id", () => {
    const repository = new ConversationAttachmentRepository(
      createTestDatabase(),
    );
    const attachment = repository.createDefaultAttachment({
      sessionId: "session-1",
      opencodeConversationId: "opencode-1",
    });

    const archived = repository.archiveAttachment(
      attachment.opencodeConversationId,
    );

    expect(archived).toMatchObject({
      sessionId: "session-1",
      opencodeConversationId: "opencode-1",
      isDefault: true,
    });
    expect(archived?.archivedAt).toBeString();
  });

  it("detects when no active conversation attachment remains", () => {
    const repository = new ConversationAttachmentRepository(
      createTestDatabase(),
    );
    const attachment = repository.createDefaultAttachment({
      sessionId: "session-1",
      opencodeConversationId: "opencode-1",
    });

    expect(repository.hasActiveAttachment("session-1")).toBe(true);

    repository.archiveAttachment(attachment.opencodeConversationId);

    expect(repository.hasActiveAttachment("session-1")).toBe(false);
  });
});

describe("ConversationAttachmentService", () => {
  it("creates a new default attachment when no active attachment remains", () => {
    const repository = new ConversationAttachmentRepository(
      createTestDatabase(),
    );
    const service = new ConversationAttachmentService(repository);
    const first = service.createDefaultAttachment({
      sessionId: "session-1",
      opencodeConversationId: "opencode-1",
    });
    service.archiveAttachment(first.opencodeConversationId);

    const replacement = service.createDefaultAttachmentWhenNoneActive({
      sessionId: "session-1",
      opencodeConversationId: "opencode-2",
    });

    expect(replacement).toMatchObject({
      sessionId: "session-1",
      opencodeConversationId: "opencode-2",
      isDefault: true,
      archivedAt: null,
    });
    expect(service.listActiveAttachments("session-1")).toHaveLength(1);
  });

  it("does not create a new default attachment while any active attachment exists", () => {
    const repository = new ConversationAttachmentRepository(
      createTestDatabase(),
    );
    const service = new ConversationAttachmentService(repository);
    service.createDefaultAttachment({
      sessionId: "session-1",
      opencodeConversationId: "opencode-1",
    });

    const replacement = service.createDefaultAttachmentWhenNoneActive({
      sessionId: "session-1",
      opencodeConversationId: "opencode-2",
    });

    expect(replacement).toBeNull();
    expect(service.listActiveAttachments("session-1")).toHaveLength(1);
  });
});
