import {
  EventMessagePartUpdated,
  EventMessageUpdated,
  Event as OpenCodeEvent,
  OpencodeClient,
} from "@opencode-ai/sdk";
import { ChatMessageData } from "../model/chat.types";
import {
  ChatRuntime,
  ChatRuntimeConversation,
  ChatRuntimeConversationNotFoundError,
  ChatRuntimeError,
} from "../model/chat-runtime.types";
import { ChatToolActivity } from "../model/chat-tool-activity.types";
import { chatContextToolRegistry } from "./chat-context-tools.service";
import {
  readSafeChatToolActivities,
  toSafeChatToolActivity,
  upsertChatToolActivity,
} from "./chat-tool-activity.service";
import { getSelectedOpenCodeModel } from "./opencode-runtime.config";
import { openCodeServerService } from "./opencode-server.service";
import { pageInspectionPermissionService } from "../../page-inspection/services/page-inspection-permission.service";

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

interface OpenCodeMessagePartDeltaEvent {
  type: "message.part.delta";
  properties: {
    sessionID: string;
    messageID: string;
    partID: string;
    field: string;
    delta: string;
  };
}

type OpenCodeStreamEvent = OpenCodeEvent | OpenCodeMessagePartDeltaEvent;

const disabledOpenCodeTools = {
  bash: false,
  edit: false,
  glob: false,
  grep: false,
  list: false,
  patch: false,
  read: false,
  skill: false,
  task: false,
  webfetch: false,
  websearch: false,
  write: false,
} as const;

export const chatContextSystemPrompt = [
  "You are the NullTrace dashboard assistant for the active testing session.",
  "Ground answers about session findings, finding details, tool run history, artifact previews, active scanner workspace state, scanner catalog availability, and scanner action drafts in the provided NullTrace context tools.",
  "Use get_session_context for the active session target, list_findings/get_finding for findings, list_tool_runs/get_artifact for tool history and artifacts, get_active_tool_workspace for the currently open scanner workspace, and list_available_scanner_tools for scanner catalog questions.",
  "For a complete sitemap overview or when comparing the sitemap count with listed entries, call list_sitemap_entries, which always lists across every crawl depth. Use search_sitemap_entries depth filters only when the operator explicitly requests a depth-filtered result; zero is a real root-level filter.",
  "Use get_authentication_context for non-secret authentication posture, import and persistence metadata, Auth Check state, authenticated crawl state, and coverage. Use search_sitemap_entries provenance and current-session access filters when authentication-specific surface or access observations matter.",
  "When authentication is absent, awaiting verification, requires action, or the authenticated crawl reports authentication_required, explain why logged-in coverage may help and direct the operator to the Authentication Context Modal.",
  "Authentication and crawler context tools are read-only. You must not mutate authentication or crawler state, request protected values, infer redacted values, or claim that an access observation proves authorization scope.",
  "Use create_action_draft when the operator asks you to prepare or propose an nmap, nuclei, ffuf, sqlmap, or Nikto scanner action for later inspection. sqlmap drafts must select one exact endpoint, GET or POST method, and one parameter present in that URL or body; use level 1-3, risk 1, a bounded time limit, and detection-only safe options. Never draft sqlmap crawling, bulk targets, enumeration, dumping, SQL or OS shells, takeover, or filesystem access. Nikto drafts may use Standard or Custom profile; Custom tuning is limited to codes 2, 3, 6, and b. Nikto mutation and evasion are prohibited. Tuning 6 is disruptive and always requires separate operator confirmation in the workspace; no draft field can satisfy it. FFUF Parameter Discovery drafts must set mode to parameter_discovery. FFUF Value Fuzzing drafts must set mode to value_fuzzing and choose one exact-origin endpoint, parameterName, query, body, or header requestLocation, payload wordlist, matchers, filters, rate, and time limit. FFUF authentication requires explicit useAuthenticatedContext selection and must never include cookie or header values in draft text or commands. Drafts never auto-run. Before creating a draft, use get_session_context and put the real target in command/form state instead of placeholders such as <TARGET>.",
  "When inspect_page is available, use it only for a relevant exact-origin page. The operator controls whether the testing session blocks inspection, uses public inspection, or uses its accepted Authenticated Request Context. The tool is read-only, does not persist results, and may return partial or truncated sections.",
  "Do not execute scanner tools, generate live scanner commands as if they were run, mutate review status, or mutate session state except by creating an action draft through create_action_draft.",
  "Action drafts are proposals only. Tell the operator that scanner execution still requires explicit review and approval in the scanner workspace.",
  "If the requested session data is unavailable from the tools, say that it is unavailable instead of inventing it.",
].join("\n");

function createChatContextToolSelection(sessionId: string) {
  return {
    ...disabledOpenCodeTools,
    ...Object.fromEntries(
      chatContextToolRegistry
        .listDefinitions()
        .filter(
          (definition) =>
            definition.name !== "inspect_page" ||
            pageInspectionPermissionService.getStatus(sessionId).status === "ready",
        )
        .map((definition) => [definition.name, true]),
    ),
  };
}

function toRuntimeError(error: unknown, action: string) {
  if (error instanceof ChatRuntimeError) {
    return error;
  }

  const detail = error instanceof Error ? error.message : String(error);
  return new ChatRuntimeError(`Could not ${action} the OpenCode conversation: ${detail}`, error);
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
  const milliseconds = timestamp < 1_000_000_000_000 ? timestamp * 1000 : timestamp;
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
  const activities = readSafeChatToolActivities(item.parts);
  if (!content && activities.length === 0) {
    return null;
  }

  return {
    id: item.info.id,
    sender: item.info.role === "assistant" ? "ai" : "user",
    content,
    timestamp: formatTimestamp(item.info.time.created),
    ...(activities.length > 0 ? { activities } : {}),
  };
}

function toChatMessages(items: OpenCodeMessageItem[]) {
  return items.flatMap((item) => {
    const message = toChatMessage(item);
    return message ? [message] : [];
  });
}

function createPromptBody(sessionId: string, text: string) {
  const model = readPromptModel();

  return {
    ...(model ? { model } : {}),
    system: chatContextSystemPrompt,
    tools: createChatContextToolSelection(sessionId),
    parts: [
      {
        type: "text" as const,
        text,
      },
    ],
  };
}

function describeStreamError(error: unknown) {
  if (!error) {
    return "OpenCode stopped generating the response.";
  }

  if (typeof error === "object" && "data" in error) {
    const data = error.data;
    if (data && typeof data === "object" && "message" in data && typeof data.message === "string") {
      return data.message;
    }
  }

  return error instanceof Error ? error.message : String(error);
}

async function streamPrompt(
  client: OpencodeClient,
  sessionId: string,
  conversationId: string,
  prompt: string,
  onProgress?: (message: ChatMessageData) => void,
) {
  const abortController = new AbortController();
  const assistantMessageIds = new Set<string>();
  const partTypeById = new Map<string, string>();
  const textByMessageId = new Map<string, Map<string, string>>();
  const activitiesByMessageId = new Map<string, ChatToolActivity[]>();
  let activeMessageId: string | null = null;
  let createdAt = Date.now();
  let isReady = false;
  let isComplete = false;
  let resolveReady: () => void;
  let rejectReady: (error: unknown) => void;
  let resolveComplete: () => void;
  let rejectComplete: (error: unknown) => void;
  const ready = new Promise<void>((resolve, reject) => {
    resolveReady = resolve;
    rejectReady = reject;
  });
  const complete = new Promise<void>((resolve, reject) => {
    resolveComplete = resolve;
    rejectComplete = reject;
  });
  const failStream = (error: unknown) => {
    if (abortController.signal.aborted || isComplete) {
      return;
    }

    isComplete = true;
    if (isReady) {
      rejectComplete(error);
    } else {
      rejectReady(error);
    }
  };
  const subscription = await client.event.subscribe({
    signal: abortController.signal,
    sseMaxRetryAttempts: 1,
    onSseError: failStream,
  });
  const emitProgress = (messageId: string) => {
    const messageParts = textByMessageId.get(messageId);
    const content = messageParts ? [...messageParts.values()].join("\n\n").trim() : "";
    const activities = activitiesByMessageId.get(messageId) ?? [];
    if (!content && activities.length === 0) {
      return;
    }

    onProgress?.({
      id: messageId,
      sender: "ai",
      content,
      timestamp: formatTimestamp(createdAt),
      ...(activities.length > 0 ? { activities } : {}),
    });
  };

  const onMessagePartUpdated = (part: EventMessagePartUpdated["properties"]["part"]) => {
    if (part.sessionID !== conversationId || !assistantMessageIds.has(part.messageID)) {
      return;
    }

    partTypeById.set(part.id, part.type);
    const activity = toSafeChatToolActivity(part);
    if (activity) {
      activeMessageId = part.messageID;
      const activities = activitiesByMessageId.get(part.messageID) ?? [];
      activitiesByMessageId.set(part.messageID, upsertChatToolActivity(activities, activity));
      emitProgress(part.messageID);
    }

    if (part.type !== "text") {
      return;
    }

    activeMessageId = part.messageID;
    const messageParts = textByMessageId.get(part.messageID) ?? new Map<string, string>();
    messageParts.set(part.id, part.text);
    textByMessageId.set(part.messageID, messageParts);
    emitProgress(part.messageID);
  };

  const onMessageUpdated = (info: EventMessageUpdated["properties"]["info"]) => {
    if (info.role !== "assistant") {
      return;
    }

    assistantMessageIds.add(info.id);
    activeMessageId = info.id;
    createdAt = info.time.created;
  };

  const onMessagePartDelta = (properties: OpenCodeMessagePartDeltaEvent["properties"]) => {
    if (
      properties.sessionID !== conversationId ||
      properties.field !== "text" ||
      partTypeById.get(properties.partID) !== "text" ||
      !assistantMessageIds.has(properties.messageID)
    ) {
      return;
    }

    activeMessageId = properties.messageID;
    const messageParts = textByMessageId.get(properties.messageID) ?? new Map<string, string>();
    const currentText = messageParts.get(properties.partID) ?? "";
    messageParts.set(properties.partID, currentText + properties.delta);
    textByMessageId.set(properties.messageID, messageParts);
    emitProgress(properties.messageID);
    return;
  };

  const consumeEvents = async () => {
    try {
      for await (const event of subscription.stream) {
        isReady = true;
        resolveReady();
        const openCodeEvent = event as OpenCodeStreamEvent;

        if (openCodeEvent.type === "message.updated") {
          const { info } = openCodeEvent.properties;
          onMessageUpdated(info);
          continue;
        }

        if (openCodeEvent.type === "message.part.updated") {
          const { part } = openCodeEvent.properties;
          onMessagePartUpdated(part);
          continue;
        }

        if (openCodeEvent.type === "message.part.delta") {
          const { properties } = openCodeEvent;
          onMessagePartDelta(properties);
          continue;
        }

        if (
          openCodeEvent.type === "session.error" &&
          openCodeEvent.properties.sessionID === conversationId
        ) {
          isComplete = true;
          rejectComplete(new Error(describeStreamError(openCodeEvent.properties.error)));
          break;
        }

        if (
          (openCodeEvent.type === "session.idle" &&
            openCodeEvent.properties.sessionID === conversationId) ||
          (openCodeEvent.type === "session.status" &&
            openCodeEvent.properties.sessionID === conversationId &&
            openCodeEvent.properties.status.type === "idle" &&
            activeMessageId)
        ) {
          isComplete = true;
          resolveComplete();
          break;
        }
      }

      if (!isComplete && !abortController.signal.aborted) {
        failStream(new Error("OpenCode event stream closed unexpectedly."));
      }
    } catch (error) {
      failStream(error);
    }
  };

  const eventConsumer = consumeEvents();

  try {
    await ready;
    await client.session.promptAsync({
      path: {
        id: conversationId,
      },
      body: createPromptBody(sessionId, prompt),
    });
    await complete;
    return [];
  } finally {
    abortController.abort();
    await eventConsumer;
  }
}

export class OpenCodeChatRuntimeService implements ChatRuntime {
  async createConversation(sessionId: string) {
    try {
      const response = await openCodeServerService.run(sessionId, "never", (client) =>
        client.session.create(),
      );

      return requireConversationData(response.data, "create");
    } catch (error) {
      throw toRuntimeError(error, "create");
    }
  }

  async getConversation(sessionId: string, conversationId: string) {
    try {
      const response = await openCodeServerService.run(sessionId, "once-after-crash", (client) =>
        client.session.get({
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
      const response = await openCodeServerService.run(sessionId, "once-after-crash", (client) =>
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

  async sendPrompt(
    sessionId: string,
    conversationId: string,
    prompt: string,
    onProgress?: (message: ChatMessageData) => void,
  ) {
    try {
      const response = await openCodeServerService.run(sessionId, "once-after-crash", (client) =>
        streamPrompt(client, sessionId, conversationId, prompt, onProgress),
      );

      return response;
    } catch (error) {
      throw toRuntimeError(error, "send a prompt to");
    }
  }

  refreshPageInspectionTools() {
    return openCodeServerService.close();
  }
}

export const openCodeChatRuntimeService = new OpenCodeChatRuntimeService();
