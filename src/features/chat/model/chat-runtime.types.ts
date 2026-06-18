export interface ChatRuntimeConversation {
  id: string;
  title: string;
}

export interface ChatRuntime {
  createConversation: () => Promise<ChatRuntimeConversation>;
  getConversation: (
    conversationId: string,
  ) => Promise<ChatRuntimeConversation>;
}

export class ChatRuntimeError extends Error {
  constructor(
    message: string,
    readonly cause?: unknown,
  ) {
    super(message);
    this.name = "ChatRuntimeError";
  }
}
