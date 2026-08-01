import { describe, expect, it } from "bun:test";
import { homedir } from "node:os";
import { basename, dirname, join } from "node:path";
import { chromium } from "playwright";
import { getAppDataDirectory } from "../../../session/services/session-database";
import { getOpenCodeRuntimeEnvironment } from "../opencode-runtime.config";
import { chatContextSystemPrompt } from "../opencode-chat-runtime.service";
import { getAuthenticationRuntimeId } from "../../../authentication/services/authentication-runtime";

function getDefaultPlaywrightBrowsersPath() {
  let directory = chromium.executablePath();
  while (basename(directory) !== "ms-playwright") {
    const parent = dirname(directory);
    if (parent === directory) {
      throw new Error("Could not locate the Playwright browser cache.");
    }
    directory = parent;
  }

  return directory;
}

describe("getOpenCodeRuntimeEnvironment", () => {
  it("preserves the app database location for chat context tools", () => {
    const environment = getOpenCodeRuntimeEnvironment();

    expect(environment.XDG_DATA_HOME).not.toBe(getAppDataDirectory());
    expect(environment.NULLTRACE_APP_DATA_DIR).toBe(getAppDataDirectory());
    expect(environment.NULLTRACE_CHAT_CONTEXT_TOOLS_IMPORT_PATH).toEndWith(
      "/src/features/chat/services/chat-context-tools.service.ts",
    );
    expect(environment.NULLTRACE_OPENCODE_PLUGIN_IMPORT_PATH).toEndWith(
      "/node_modules/@opencode-ai/plugin/dist/index.js",
    );
    expect(environment.NULLTRACE_RUNTIME_ID).toBe(getAuthenticationRuntimeId());
  });

  it("preserves the parent Playwright browser cache for the isolated chat runtime", () => {
    const environment = getOpenCodeRuntimeEnvironment();

    expect(environment.PLAYWRIGHT_BROWSERS_PATH).toBe(
      process.env.PLAYWRIGHT_BROWSERS_PATH ?? getDefaultPlaywrightBrowsersPath(),
    );
  });

  it("preserves access to the parent macOS login keychain under isolated HOME", () => {
    if (process.platform !== "darwin") {
      return;
    }
    const environment = getOpenCodeRuntimeEnvironment();

    expect(environment.HOME).not.toBe(homedir());
    expect(environment.NULLTRACE_MACOS_KEYCHAIN_PATH).toBe(
      join(homedir(), "Library", "Keychains", "login.keychain-db"),
    );
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

  it("keeps page inspection disabled until a session grant enables the prompt tool", () => {
    const environment = getOpenCodeRuntimeEnvironment();
    const config = JSON.parse(environment.OPENCODE_CONFIG_CONTENT);

    expect(config.permission.inspect_page).toBe("allow");
    expect(environment.NULLTRACE_PAGE_INSPECTION_MODES).toBe("{}");
    expect(chatContextSystemPrompt).toContain("inspect_page");
    expect(chatContextSystemPrompt).toContain("operator controls");
  });

  it("guides chat to create FFUF, targeted sqlmap, and Nikto action drafts", () => {
    expect(chatContextSystemPrompt).toContain("nmap, nuclei, ffuf, sqlmap, or Nikto");
    expect(chatContextSystemPrompt).toContain("one exact endpoint");
    expect(chatContextSystemPrompt).toContain("Never draft sqlmap crawling");
    expect(chatContextSystemPrompt).toContain(
      "sqlmap authentication requires explicit useAuthenticatedContext selection",
    );
    expect(chatContextSystemPrompt).toContain("Nikto drafts may use Standard or Custom profile");
    expect(chatContextSystemPrompt).toContain("no draft field can satisfy it");
    expect(chatContextSystemPrompt).toContain("create_action_draft");
  });
});
