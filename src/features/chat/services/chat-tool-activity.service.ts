import { ChatToolActivity, ChatToolActivityStatus } from "../model/chat-tool-activity.types";

const toolLabels: Record<string, string> = {
  get_sitemap_status: "Get sitemap status",
  list_sitemap_entries: "List sitemap entries",
  search_sitemap_entries: "Search sitemap entries",
  get_sitemap_entry: "Get sitemap entry",
  get_session_context: "Get session context",
  list_findings: "List findings",
  get_finding: "Get finding",
  list_tool_runs: "List tool runs",
  get_artifact: "Get artifact preview",
  get_active_tool_workspace: "Get active tool workspace",
  list_available_scanner_tools: "List scanner tools",
  create_action_draft: "Create action draft",
};

interface OpenCodeToolPart {
  id?: unknown;
  type?: unknown;
  tool?: unknown;
  state?: {
    status?: unknown;
  };
}

function getToolActivityStatus(status: unknown): ChatToolActivityStatus | null {
  if (status === "pending" || status === "running") {
    return "running";
  }

  if (status === "completed") {
    return "completed";
  }

  if (status === "error") {
    return "failed";
  }

  return null;
}

function isOpenCodeToolPart(part: unknown): part is OpenCodeToolPart {
  return Boolean(part && typeof part === "object" && "type" in part);
}

export function toSafeChatToolActivity(part: unknown): ChatToolActivity | null {
  if (!isOpenCodeToolPart(part) || part.type !== "tool") {
    return null;
  }

  if (typeof part.id !== "string" || typeof part.tool !== "string") {
    return null;
  }

  const label = toolLabels[part.tool];
  const status = getToolActivityStatus(part.state?.status);
  if (!label || !status) {
    return null;
  }

  return {
    id: part.id,
    label,
    status,
  };
}

export function upsertChatToolActivity(
  activities: ChatToolActivity[],
  nextActivity: ChatToolActivity,
) {
  const existingIndex = activities.findIndex((activity) => activity.id === nextActivity.id);
  if (existingIndex === -1) {
    return [...activities, nextActivity];
  }

  return activities.map((activity, index) => (index === existingIndex ? nextActivity : activity));
}

export function readSafeChatToolActivities(parts: unknown[]) {
  return parts.reduce<ChatToolActivity[]>((activities, part) => {
    const activity = toSafeChatToolActivity(part);
    return activity ? upsertChatToolActivity(activities, activity) : activities;
  }, []);
}
