export interface ConversationAttachmentInput {
  sessionId: string;
  opencodeConversationId: string;
}

export interface ConversationAttachmentRecord extends ConversationAttachmentInput {
  isDefault: boolean;
  archivedAt: string | null;
  createdAt: string;
}
