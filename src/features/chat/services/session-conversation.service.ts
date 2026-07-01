import {
  ChatRuntime,
  ChatRuntimeConversationNotFoundError,
  ChatRuntimeError,
} from "../model/chat-runtime.types";
import { ConversationAttachmentRecord } from "../model/conversation-attachment.types";
import {
  ConversationAttachmentService,
  conversationAttachmentService,
} from "./conversation-attachment.service";
import { openCodeChatRuntimeService } from "./opencode-chat-runtime.service";

export interface ActiveSessionConversation {
  attachment: ConversationAttachmentRecord;
  title: string;
}

interface ConversationAttachmentBoundary {
  listActiveAttachments: (sessionId: string) => ConversationAttachmentRecord[];
  createDefaultAttachment: (input: {
    sessionId: string;
    opencodeConversationId: string;
  }) => ConversationAttachmentRecord;
  createAttachment: (input: {
    sessionId: string;
    opencodeConversationId: string;
  }) => ConversationAttachmentRecord;
  archiveAttachment: (
    opencodeConversationId: string,
  ) => ConversationAttachmentRecord | null;
}

function toSessionConversationError(error: unknown) {
  if (error instanceof ChatRuntimeError) {
    return error;
  }

  const detail = error instanceof Error ? error.message : String(error);
  return new ChatRuntimeError(
    `Could not prepare the session conversation: ${detail}`,
    error,
  );
}

export class SessionConversationService {
  constructor(
    private readonly attachments: ConversationAttachmentBoundary =
      conversationAttachmentService,
    private readonly runtime: ChatRuntime = openCodeChatRuntimeService,
  ) {}

  async listActiveConversations(
    sessionId: string,
  ): Promise<ActiveSessionConversation[]> {
    try {
      const conversations: ActiveSessionConversation[] = [];

      for (const attachment of this.attachments.listActiveAttachments(
        sessionId,
      )) {
        try {
          const conversation = await this.runtime.getConversation(
            sessionId,
            attachment.opencodeConversationId,
          );
          conversations.push({
            attachment,
            title: conversation.title,
          });
        } catch (error) {
          if (!(error instanceof ChatRuntimeConversationNotFoundError)) {
            throw error;
          }

          this.attachments.archiveAttachment(
            attachment.opencodeConversationId,
          );
        }
      }

      return conversations;
    } catch (error) {
      throw toSessionConversationError(error);
    }
  }

  async prepareSessionConversations(
    sessionId: string,
  ): Promise<ActiveSessionConversation[]> {
    try {
      const conversations = await this.listActiveConversations(sessionId);
      if (conversations.length > 0) {
        return conversations;
      }

      const conversation = await this.runtime.createConversation(sessionId);
      const attachment = this.attachments.createDefaultAttachment({
        sessionId,
        opencodeConversationId: conversation.id,
      });

      return [{ attachment, title: conversation.title }];
    } catch (error) {
      throw toSessionConversationError(error);
    }
  }

  async createConversation(
    sessionId: string,
  ): Promise<ActiveSessionConversation> {
    try {
      const conversation = await this.runtime.createConversation(sessionId);
      const attachment = this.attachments.createAttachment({
        sessionId,
        opencodeConversationId: conversation.id,
      });

      return { attachment, title: conversation.title };
    } catch (error) {
      throw toSessionConversationError(error);
    }
  }

  async archiveConversation(
    sessionId: string,
    opencodeConversationId: string,
  ): Promise<ActiveSessionConversation[]> {
    try {
      const activeAttachments =
        this.attachments.listActiveAttachments(sessionId);
      if (
        !activeAttachments.some(
          (attachment) =>
            attachment.opencodeConversationId === opencodeConversationId,
        )
      ) {
        return this.listActiveConversations(sessionId);
      }

      this.attachments.archiveAttachment(opencodeConversationId);

      return this.prepareSessionConversations(sessionId);
    } catch (error) {
      throw toSessionConversationError(error);
    }
  }

  async ensureActiveConversation(
    sessionId: string,
  ): Promise<ActiveSessionConversation> {
    const [conversation] = await this.prepareSessionConversations(sessionId);
    return conversation!;
  }
}

export const sessionConversationService = new SessionConversationService();
