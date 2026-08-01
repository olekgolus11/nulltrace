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

  it("shows a running page inspection with only its normalized path", () => {
    const activity = toSafeChatToolActivity({
      id: "part-inspect-page",
      type: "tool",
      tool: "inspect_page",
      state: {
        status: "running",
        input: {
          url: "https://operator:password@example.test/admin/../security.php?token=protected#private",
          authorization: "Bearer protected-value",
        },
      },
    });

    expect(activity).toEqual({
      id: "part-inspect-page",
      label: "Inspect page /security.php",
      status: "running",
    });
    expect(JSON.stringify(activity)).not.toContain("operator");
    expect(JSON.stringify(activity)).not.toContain("password");
    expect(JSON.stringify(activity)).not.toContain("token");
    expect(JSON.stringify(activity)).not.toContain("protected");
    expect(JSON.stringify(activity)).not.toContain("private");
  });

  it("maps completed and failed page inspection states", () => {
    const completed = toSafeChatToolActivity({
      id: "part-inspect-completed",
      type: "tool",
      tool: "inspect_page",
      state: {
        status: "completed",
        input: { url: "https://example.test/account" },
        output: "protected page snapshot",
      },
    });
    const failed = toSafeChatToolActivity({
      id: "part-inspect-failed",
      type: "tool",
      tool: "inspect_page",
      state: {
        status: "error",
        input: { url: "https://example.test/login" },
        error: "protected failure detail",
      },
    });

    expect([completed, failed]).toEqual([
      {
        id: "part-inspect-completed",
        label: "Inspect page /account",
        status: "completed",
      },
      {
        id: "part-inspect-failed",
        label: "Inspect page /login",
        status: "failed",
      },
    ]);
  });

  it("uses a static page inspection label for unavailable or invalid URLs", () => {
    const inputs = [
      undefined,
      {},
      { url: null },
      { url: "" },
      { url: "/secret?token=protected" },
      { url: "https://" },
      { url: "javascript:protected-value" },
    ];
    const activities = inputs.map((input, index) =>
      toSafeChatToolActivity({
        id: `part-inspect-invalid-${index}`,
        type: "tool",
        tool: "inspect_page",
        state: {
          status: "completed",
          input,
        },
      }),
    );

    expect(activities.map((activity) => activity?.label)).toEqual(
      inputs.map(() => "Inspect page"),
    );
    expect(JSON.stringify(activities)).not.toContain("secret");
    expect(JSON.stringify(activities)).not.toContain("protected");
  });

  it("does not expose path-carried secrets or unbounded paths", () => {
    const urls = [
      "https://example.test/account;jsessionid=protected-session",
      "https://example.test/reset/protected-reset-token",
      `https://example.test/${"a".repeat(300)}`,
    ];
    const activities = urls.map((url, index) =>
      toSafeChatToolActivity({
        id: `part-inspect-unsafe-${index}`,
        type: "tool",
        tool: "inspect_page",
        state: {
          status: "running",
          input: { url },
        },
      }),
    );

    expect(activities.map((activity) => activity?.label)).toEqual(
      urls.map(() => "Inspect page"),
    );
    expect(JSON.stringify(activities)).not.toContain("protected");
    expect(JSON.stringify(activities).length).toBeLessThan(300);
  });

  it("reconstructs persisted page inspection history with the same safe mapping", () => {
    const persistedActivities = readSafeChatToolActivities([
      {
        id: "part-inspect-history",
        type: "tool",
        tool: "inspect_page",
        state: {
          status: "completed",
          input: {
            url: "https://user:password@example.test/private/../security.php?api_key=protected#secret",
            cookie: "session=protected-cookie",
          },
          output: "protected page contents",
        },
      },
    ]);

    expect(persistedActivities).toEqual([
      {
        id: "part-inspect-history",
        label: "Inspect page /security.php",
        status: "completed",
      },
    ]);
    expect(JSON.stringify(persistedActivities)).not.toContain("user");
    expect(JSON.stringify(persistedActivities)).not.toContain("password");
    expect(JSON.stringify(persistedActivities)).not.toContain("api_key");
    expect(JSON.stringify(persistedActivities)).not.toContain("protected");
    expect(JSON.stringify(persistedActivities)).not.toContain("secret");
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

    const activities = upsertChatToolActivity([running!, failed!], completed!);

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
