import { createOpencode } from "@opencode-ai/sdk";
import { ChatMessageData } from "../model/chat.types";
import {
  ChatRuntime,
  ChatRuntimeConversation,
  ChatRuntimeError,
} from "../model/chat-runtime.types";

type OpenCodeRuntime = Awaited<ReturnType<typeof createOpencode>>;
type OpenCodeClient = OpenCodeRuntime["client"];
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

function readNumberEnv(name: string, fallback: number) {
  const rawValue = process.env[name];
  if (!rawValue) {
    return fallback;
  }

  const parsedValue = Number(rawValue);
  return Number.isFinite(parsedValue) ? parsedValue : fallback;
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

function readPromptModel(): PromptModel | undefined {
  const providerID = process.env.OPENCODE_PROVIDER_ID;
  const modelID = process.env.OPENCODE_MODEL_ID;

  if (!providerID || !modelID) {
    return undefined;
  }

  return {
    providerID,
    modelID,
  };
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

async function withOpenCodeClient<T>(
  operation: (client: OpenCodeClient) => Promise<T>,
) {
  const runtime = await createOpencode({
    hostname: process.env.OPENCODE_HOSTNAME ?? "127.0.0.1",
    port: readNumberEnv("OPENCODE_PORT", 4096),
    timeout: readNumberEnv("OPENCODE_TIMEOUT_MS", 10000),
  });

  try {
    return await operation(runtime.client);
  } finally {
    runtime.server.close();
  }
}

export class OpenCodeChatRuntimeService implements ChatRuntime {
  async createConversation() {
    try {
      const response = await withOpenCodeClient((client) =>
        client.session.create(),
      );

      return requireConversationData(response.data, "create");
    } catch (error) {
      throw toRuntimeError(error, "create");
    }
  }

  async getConversation(conversationId: string) {
    try {
      const response = await withOpenCodeClient((client) =>
        client.session.get({
          path: {
            id: conversationId,
          },
        }),
      );

      return requireConversationData(response.data, "reopen");
    } catch (error) {
      throw toRuntimeError(error, "reopen");
    }
  }

  async listMessages(conversationId: string) {
    try {
      const response = await withOpenCodeClient((client) =>
        client.session.messages({
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

  async sendPrompt(conversationId: string, prompt: string) {
    try {
      const response = await withOpenCodeClient((client) =>
        client.session.prompt({
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
