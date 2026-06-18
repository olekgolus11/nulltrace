import { ChatMessageData } from "./chat.types";

export interface ChatRuntimeConversation {
  id: string;
  title: string;
}

export interface ChatRuntime {
  createConversation: () => Promise<ChatRuntimeConversation>;
  getConversation: (
    conversationId: string,
  ) => Promise<ChatRuntimeConversation>;
  listMessages: (conversationId: string) => Promise<ChatMessageData[]>;
  sendPrompt: (
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
