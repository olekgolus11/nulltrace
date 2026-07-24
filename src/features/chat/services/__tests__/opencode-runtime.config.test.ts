import { describe, expect, it } from "bun:test";
import { getAppDataDirectory } from "../../../session/services/session-database";
import { getOpenCodeRuntimeEnvironment } from "../opencode-runtime.config";
import { chatContextSystemPrompt } from "../opencode-chat-runtime.service";
import { getAuthenticationRuntimeId } from "../../../authentication/services/authentication-runtime";

describe("getOpenCodeRuntimeEnvironment", () => {
  it("preserves the app database location for chat context tools", () => {
    const environment = getOpenCodeRuntimeEnvironment();

    expect(environment.XDG_DATA_HOME).not.toBe(getAppDataDirectory());
    expect(environment.NULLTRACE_APP_DATA_DIR).toBe(getAppDataDirectory());
    expect(environment.NULLTRACE_RUNTIME_ID).toBe(getAuthenticationRuntimeId());
  });

  it("allows every read-only sitemap context tool", () => {
    const environment = getOpenCodeRuntimeEnvironment();
    const config = JSON.parse(environment.OPENCODE_CONFIG_CONTENT);

    expect(config.permission).toMatchObject({
      get_sitemap_status: "allow",
      list_sitemap_entries: "allow",
      search_sitemap_entries: "allow",
      get_sitemap_entry: "allow",
    });
  });

  it("allows auth metadata reads and guides operators to the auth modal", () => {
    const environment = getOpenCodeRuntimeEnvironment();
    const config = JSON.parse(environment.OPENCODE_CONFIG_CONTENT);

    expect(config.permission.get_authentication_context).toBe("allow");
    expect(chatContextSystemPrompt).toContain("get_authentication_context");
    expect(chatContextSystemPrompt).toContain("Authentication Context Modal");
    expect(chatContextSystemPrompt).toContain("must not mutate");
  });

  it("guides chat to create FFUF action drafts", () => {
    expect(chatContextSystemPrompt).toContain("nmap, nuclei, or ffuf");
    expect(chatContextSystemPrompt).toContain("create_action_draft");
  });
});
