import { describe, expect, it } from "bun:test";
import { ChatRuntime } from "../../model/chat-runtime.types";
import { ConversationAttachmentRecord } from "../../model/conversation-attachment.types";
import { SessionConversationService } from "../session-conversation.service";

class FakeConversationAttachmentService {
  attachments: ConversationAttachmentRecord[] = [];

  listActiveAttachments(sessionId: string) {
    return this.attachments.filter(
      (attachment) =>
        attachment.sessionId === sessionId && !attachment.archivedAt,
    );
  }

  createDefaultAttachment(input: {
    sessionId: string;
    opencodeConversationId: string;
  }) {
    const attachment: ConversationAttachmentRecord = {
      sessionId: input.sessionId,
      opencodeConversationId: input.opencodeConversationId,
      isDefault: true,
      archivedAt: null,
      createdAt: new Date().toISOString(),
    };

    this.attachments.push(attachment);
    return attachment;
  }

  archiveAttachment(opencodeConversationId: string) {
    const attachment = this.attachments.find(
      (candidate) =>
        candidate.opencodeConversationId === opencodeConversationId,
    );
    if (!attachment) {
      return null;
    }

    attachment.archivedAt = new Date().toISOString();
    return attachment;
  }
}

class FakeChatRuntime implements ChatRuntime {
  createdConversationIds: string[] = [];
  reopenedConversationIds: string[] = [];

  async createConversation() {
    const id = `opencode-${this.createdConversationIds.length + 1}`;
    this.createdConversationIds.push(id);

    return {
      id,
      title: `Conversation ${this.createdConversationIds.length}`,
    };
  }

  async getConversation(_sessionId: string, conversationId: string) {
    this.reopenedConversationIds.push(conversationId);

    return {
      id: conversationId,
      title: "Existing conversation",
    };
  }

  async listMessages() {
    return [];
  }

  async sendPrompt() {
    return [];
  }
}

describe("SessionConversationService", () => {
  it("creates and stores a default conversation when none is active", async () => {
    const attachments = new FakeConversationAttachmentService();
    const runtime = new FakeChatRuntime();
    const service = new SessionConversationService(attachments, runtime);

    const activeConversation =
      await service.ensureActiveConversation("session-1");

    expect(activeConversation.attachment).toMatchObject({
      sessionId: "session-1",
      opencodeConversationId: "opencode-1",
      isDefault: true,
      archivedAt: null,
    });
    expect(activeConversation.title).toBe("Conversation 1");
    expect(runtime.createdConversationIds).toEqual(["opencode-1"]);
  });

  it("reopens the existing active conversation instead of creating one", async () => {
    const attachments = new FakeConversationAttachmentService();
    attachments.createDefaultAttachment({
      sessionId: "session-1",
      opencodeConversationId: "opencode-existing",
    });
    const runtime = new FakeChatRuntime();
    const service = new SessionConversationService(attachments, runtime);

    const activeConversation =
      await service.ensureActiveConversation("session-1");

    expect(activeConversation.attachment.opencodeConversationId).toBe(
      "opencode-existing",
    );
    expect(activeConversation.title).toBe("Existing conversation");
    expect(runtime.createdConversationIds).toEqual([]);
    expect(runtime.reopenedConversationIds).toEqual(["opencode-existing"]);
  });

  it("creates a new default conversation when prior attachments are archived", async () => {
    const attachments = new FakeConversationAttachmentService();
    attachments.attachments.push({
      sessionId: "session-1",
      opencodeConversationId: "opencode-archived",
      isDefault: true,
      archivedAt: "2026-06-17T10:00:00.000Z",
      createdAt: "2026-06-17T09:00:00.000Z",
    });
    const runtime = new FakeChatRuntime();
    const service = new SessionConversationService(attachments, runtime);

    const activeConversation =
      await service.ensureActiveConversation("session-1");

    expect(activeConversation.attachment.opencodeConversationId).toBe(
      "opencode-1",
    );
    expect(activeConversation.attachment.isDefault).toBe(true);
    expect(runtime.createdConversationIds).toEqual(["opencode-1"]);
  });
});
