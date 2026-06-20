import { ChatMessageData } from "./chat.types";

export interface ChatRuntimeConversation {
  id: string;
  title: string;
}

export interface ChatRuntime {
  createConversation: (sessionId: string) => Promise<ChatRuntimeConversation>;
  getConversation: (
    sessionId: string,
    conversationId: string,
  ) => Promise<ChatRuntimeConversation>;
  listMessages: (
    sessionId: string,
    conversationId: string,
  ) => Promise<ChatMessageData[]>;
  sendPrompt: (
    sessionId: string,
    conversationId: string,
    prompt: string,
  ) => Promise<ChatMessageData[]>;
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

export class ChatRuntimeConversationNotFoundError extends ChatRuntimeError {
  constructor(
    message: string,
    cause?: unknown,
  ) {
    super(message, cause);
    this.name = "ChatRuntimeConversationNotFoundError";
  }
}
