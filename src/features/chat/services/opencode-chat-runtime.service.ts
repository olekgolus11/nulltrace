import { ChatMessageData } from "../model/chat.types";
import {
  ChatRuntime,
  ChatRuntimeConversation,
  ChatRuntimeConversationNotFoundError,
  ChatRuntimeError,
} from "../model/chat-runtime.types";
import { getSelectedOpenCodeModel } from "./opencode-runtime.config";
import { openCodeServerService } from "./opencode-server.service";

type OpenCodeMessageItem = {
  info: {
    id: string;
    role: "assistant" | "user";
    time: {
      created: number;
    };
  };
  parts: Array<{
    type: string;
    text?: string;
  }>;
};

interface PromptModel {
  providerID: string;
  modelID: string;
}

function toRuntimeError(error: unknown, action: string) {
  if (error instanceof ChatRuntimeError) {
    return error;
  }

  const detail = error instanceof Error ? error.message : String(error);
  return new ChatRuntimeError(
    `Could not ${action} the OpenCode conversation: ${detail}`,
    error,
  );
}

function getErrorStatus(error: unknown): number | null {
  if (!error || typeof error !== "object") {
    return null;
  }

  if ("status" in error && typeof error.status === "number") {
    return error.status;
  }

  if ("cause" in error) {
    return getErrorStatus(error.cause);
  }

  return null;
}

function readPromptModel(): PromptModel | undefined {
  const providerID = process.env.OPENCODE_PROVIDER_ID;
  const modelID = process.env.OPENCODE_MODEL_ID;

  if (providerID && modelID) {
    return {
      providerID,
      modelID,
    };
  }

  return getSelectedOpenCodeModel();
}

function requireConversationData(
  conversation: ChatRuntimeConversation | undefined,
  action: string,
) {
  if (!conversation) {
    throw new ChatRuntimeError(
      `Could not ${action} the OpenCode conversation: OpenCode returned no conversation data.`,
    );
  }

  return conversation;
}

function requireData<T>(value: T | undefined, action: string) {
  if (value === undefined) {
    throw new ChatRuntimeError(
      `Could not ${action} the OpenCode conversation: OpenCode returned no data.`,
    );
  }

  return value;
}

function formatTimestamp(timestamp: number) {
  const milliseconds =
    timestamp < 1_000_000_000_000 ? timestamp * 1000 : timestamp;
  return new Date(milliseconds).toLocaleTimeString([], {
    hour: "2-digit",
    minute: "2-digit",
  });
}

function readTextContent(parts: OpenCodeMessageItem["parts"]) {
  return parts
    .filter((part) => part.type === "text" && part.text)
    .map((part) => part.text)
    .join("\n\n")
    .trim();
}

function toChatMessage(item: OpenCodeMessageItem): ChatMessageData | null {
  const content = readTextContent(item.parts);
  if (!content) {
    return null;
  }

  return {
    id: item.info.id,
    sender: item.info.role === "assistant" ? "ai" : "user",
    content,
    timestamp: formatTimestamp(item.info.time.created),
  };
}

function toChatMessages(items: OpenCodeMessageItem[]) {
  return items.flatMap((item) => {
    const message = toChatMessage(item);
    return message ? [message] : [];
  });
}

function createPromptBody(text: string) {
  const model = readPromptModel();

  return {
    ...(model ? { model } : {}),
    parts: [
      {
        type: "text" as const,
        text,
      },
    ],
  };
}

export class OpenCodeChatRuntimeService implements ChatRuntime {
  async createConversation(sessionId: string) {
    try {
      const response = await openCodeServerService.run(
        sessionId,
        "never",
        (client) => client.session.create(),
      );

      return requireConversationData(response.data, "create");
    } catch (error) {
      throw toRuntimeError(error, "create");
    }
  }

  async getConversation(sessionId: string, conversationId: string) {
    try {
      const response = await openCodeServerService.run(
        sessionId,
        "once-after-crash",
        (client) => client.session.get({
          path: {
            id: conversationId,
          },
        }),
      );

      return requireConversationData(response.data, "reopen");
    } catch (error) {
      if (getErrorStatus(error) === 404) {
        throw new ChatRuntimeConversationNotFoundError(
          `Could not reopen the OpenCode conversation: conversation ${conversationId} was not found in this session workspace.`,
          error,
        );
      }
      throw toRuntimeError(error, "reopen");
    }
  }

  async listMessages(sessionId: string, conversationId: string) {
    try {
      const response = await openCodeServerService.run(
        sessionId,
        "once-after-crash",
        (client) => client.session.messages({
          path: {
            id: conversationId,
          },
        }),
      );

      return toChatMessages(requireData(response.data, "load messages from"));
    } catch (error) {
      throw toRuntimeError(error, "load messages from");
    }
  }

  async sendPrompt(
    sessionId: string,
    conversationId: string,
    prompt: string,
  ) {
    try {
      const response = await openCodeServerService.run(
        sessionId,
        "once-after-crash",
        (client) => client.session.prompt({
          path: {
            id: conversationId,
          },
          body: createPromptBody(prompt),
        }),
      );

      return toChatMessages([requireData(response.data, "send a prompt to")]);
    } catch (error) {
      throw toRuntimeError(error, "send a prompt to");
    }
  }
}

export const openCodeChatRuntimeService = new OpenCodeChatRuntimeService();
