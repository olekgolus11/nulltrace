import {
  ConversationAttachmentInput,
  ConversationAttachmentRecord,
} from "../model/conversation-attachment.types";
import {
  ConversationAttachmentRepository,
  conversationAttachmentRepository,
} from "./conversation-attachment.repository";

export class ConversationAttachmentService {
  constructor(
    private readonly repository: ConversationAttachmentRepository = conversationAttachmentRepository,
  ) {}

  createDefaultAttachment(input: ConversationAttachmentInput) {
    return this.repository.createDefaultAttachment(input);
  }

  createAttachment(input: ConversationAttachmentInput) {
    return this.repository.createAttachment(input);
  }

  listActiveAttachments(sessionId: string) {
    return this.repository.listActiveBySessionId(sessionId);
  }

  archiveAttachment(opencodeConversationId: string) {
    return this.repository.archiveAttachment(opencodeConversationId);
  }

  findActiveAttachmentByOpenCodeConversationId(opencodeConversationId: string) {
    return this.repository.findActiveByOpenCodeConversationId(opencodeConversationId);
  }

  hasActiveAttachment(sessionId: string) {
    return this.repository.hasActiveAttachment(sessionId);
  }

  createDefaultAttachmentWhenNoneActive(
    input: ConversationAttachmentInput,
  ): ConversationAttachmentRecord | null {
    if (this.repository.hasActiveAttachment(input.sessionId)) {
      return null;
    }

    return this.repository.createDefaultAttachment(input);
  }
}

export const conversationAttachmentService = new ConversationAttachmentService();
