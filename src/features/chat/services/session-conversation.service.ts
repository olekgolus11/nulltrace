import { ChatRuntime, ChatRuntimeError } from "../model/chat-runtime.types";
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

  async ensureActiveConversation(
    sessionId: string,
  ): Promise<ActiveSessionConversation> {
    try {
      const [activeAttachment] =
        this.attachments.listActiveAttachments(sessionId);

      if (activeAttachment) {
        const conversation = await this.runtime.getConversation(
          activeAttachment.opencodeConversationId,
        );

        return {
          attachment: activeAttachment,
          title: conversation.title,
        };
      }

      const conversation = await this.runtime.createConversation();
      const attachment = this.attachments.createDefaultAttachment({
        sessionId,
        opencodeConversationId: conversation.id,
      });

      return {
        attachment,
        title: conversation.title,
      };
    } catch (error) {
      throw toSessionConversationError(error);
    }
  }
}

export const sessionConversationService = new SessionConversationService();
