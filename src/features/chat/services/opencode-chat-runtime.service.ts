import { createOpencode } from "@opencode-ai/sdk";
import {
  ChatRuntime,
  ChatRuntimeConversation,
  ChatRuntimeError,
} from "../model/chat-runtime.types";

type OpenCodeRuntime = Awaited<ReturnType<typeof createOpencode>>;
type OpenCodeClient = OpenCodeRuntime["client"];

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
}

export const openCodeChatRuntimeService = new OpenCodeChatRuntimeService();
