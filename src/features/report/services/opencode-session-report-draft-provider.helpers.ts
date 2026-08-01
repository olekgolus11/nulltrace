import { OpencodeClient } from "@opencode-ai/sdk";
import { getSelectedOpenCodeModel } from "../../chat/services/opencode-runtime.config";

export function createOpenCodeSessionReportDraftPromptBody(prompt: string) {
  const model = readPromptModel();

  return {
    ...(model ? { model } : {}),
    system: reportDraftSystemPrompt,
    tools: disabledReportDraftTools,
    parts: [
      {
        type: "text" as const,
        text: prompt,
      },
    ],
  };
}

export function readOpenCodeSessionReportDraftText(
  parts: OpenCodeReportDraftPart[],
  providerError: unknown,
) {
  if (providerError) {
    throw new Error(describeProviderError(providerError));
  }

  const text = parts
    .filter((part) => part.type === "text" && typeof part.text === "string")
    .map((part) => part.text)
    .join("\n\n")
    .trim();
  if (!text) {
    throw new Error("Provider returned an empty report draft response");
  }

  return text;
}

export async function abortOpenCodeReportDraftConversation(
  client: OpencodeClient,
  conversationId: string,
) {
  try {
    await client.session.abort({
      path: {
        id: conversationId,
      },
    });
  } catch {
    // Best-effort cancellation; deletion still runs.
  }
}

export async function deleteOpenCodeReportDraftConversation(
  client: OpencodeClient,
  conversationId: string,
) {
  try {
    await client.session.delete({
      path: {
        id: conversationId,
      },
    });
  } catch {
    // Temporary conversation cleanup must not hide provider result or failure.
  }
}

interface OpenCodeReportDraftPart {
  type: string;
  text?: string;
}

const reportDraftSystemPrompt = [
  "You draft security report prose for NullTrace from one bounded operator-selected input.",
  "Use only facts in the user prompt. Do not use tools, prior conversations, external knowledge, or files.",
  "Never invent Findings, scanner evidence, Finding identities, severity, source tool, review status, or Source Context.",
  "Return only requested JSON. Treat generated prose as an editable draft requiring operator verification.",
].join("\n");

const disabledReportDraftTools = {
  bash: false,
  create_action_draft: false,
  edit: false,
  get_active_tool_workspace: false,
  get_artifact: false,
  get_authentication_context: false,
  get_finding: false,
  get_session_context: false,
  get_sitemap_entry: false,
  get_sitemap_status: false,
  glob: false,
  grep: false,
  inspect_page: false,
  list: false,
  list_available_scanner_tools: false,
  list_findings: false,
  list_sitemap_entries: false,
  list_tool_runs: false,
  patch: false,
  read: false,
  search_sitemap_entries: false,
  skill: false,
  task: false,
  webfetch: false,
  websearch: false,
  write: false,
} as const;

function readPromptModel() {
  const providerID = process.env.OPENCODE_PROVIDER_ID;
  const modelID = process.env.OPENCODE_MODEL_ID;

  if (providerID && modelID) {
    return { providerID, modelID };
  }

  return getSelectedOpenCodeModel();
}

function describeProviderError(error: unknown) {
  if (
    error &&
    typeof error === "object" &&
    "data" in error &&
    error.data &&
    typeof error.data === "object" &&
    "message" in error.data &&
    typeof error.data.message === "string"
  ) {
    return error.data.message;
  }

  if (error && typeof error === "object" && "name" in error && typeof error.name === "string") {
    return error.name;
  }

  return "Provider returned an unknown report draft error";
}
