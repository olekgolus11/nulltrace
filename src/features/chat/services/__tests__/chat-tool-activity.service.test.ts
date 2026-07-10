import { describe, expect, it } from "bun:test";
import {
  readSafeChatToolActivities,
  toSafeChatToolActivity,
  upsertChatToolActivity,
} from "../chat-tool-activity.service";

describe("chat tool activity mapping", () => {
  it("maps streamed tool parts to a safe running activity", () => {
    const activity = toSafeChatToolActivity({
      id: "part-session-context",
      type: "tool",
      tool: "get_session_context",
      state: {
        status: "pending",
        input: {
          authorization: "Bearer protected-value",
          sessionId: "session-secret",
        },
        raw: "protected raw input",
      },
    });

    expect(activity).toEqual({
      id: "part-session-context",
      label: "Get session context",
      status: "running",
    });
  });

  it("updates a tool lifecycle without changing its original position", () => {
    const running = toSafeChatToolActivity({
      id: "part-findings",
      type: "tool",
      tool: "list_findings",
      state: { status: "running" },
    });
    const completed = toSafeChatToolActivity({
      id: "part-findings",
      type: "tool",
      tool: "list_findings",
      state: {
        status: "completed",
        output: "private finding payload",
      },
    });
    const failed = toSafeChatToolActivity({
      id: "part-artifact",
      type: "tool",
      tool: "get_artifact",
      state: { status: "error", error: "vault content" },
    });

    expect(running).not.toBeNull();
    expect(completed).not.toBeNull();
    expect(failed).not.toBeNull();

    const activities = upsertChatToolActivity(
      [running!, failed!],
      completed!,
    );

    expect(activities).toEqual([
      {
        id: "part-findings",
        label: "List findings",
        status: "completed",
      },
      {
        id: "part-artifact",
        label: "Get artifact preview",
        status: "failed",
      },
    ]);
  });

  it("keeps ordered final-message tool history and excludes unsafe fields", () => {
    const activities = readSafeChatToolActivities([
      { id: "text-1", type: "text", text: "Summary" },
      {
        id: "part-sitemap",
        type: "tool",
        tool: "get_sitemap_status",
        state: {
          status: "completed",
          input: { cookie: "auth-cookie" },
          output: "Evidence Vault material",
          metadata: { target: "https://protected.example" },
        },
      },
      {
        id: "part-draft",
        type: "tool",
        tool: "create_action_draft",
        state: {
          status: "error",
          input: { command: "nmap -sV protected.example" },
          error: "protected failure detail",
        },
      },
      {
        id: "part-unknown",
        type: "tool",
        tool: "unexpected_tool_with_secret",
        state: { status: "completed", output: "secret" },
      },
    ]);

    expect(activities).toEqual([
      {
        id: "part-sitemap",
        label: "Get sitemap status",
        status: "completed",
      },
      {
        id: "part-draft",
        label: "Create action draft",
        status: "failed",
      },
    ]);
    expect(JSON.stringify(activities)).not.toContain("auth-cookie");
    expect(JSON.stringify(activities)).not.toContain("Evidence Vault material");
    expect(JSON.stringify(activities)).not.toContain("protected.example");
    expect(JSON.stringify(activities)).not.toContain("protected failure detail");
  });
});
