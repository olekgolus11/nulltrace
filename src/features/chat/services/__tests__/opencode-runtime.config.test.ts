import { describe, expect, it } from "bun:test";
import { basename, dirname } from "node:path";
import { chromium } from "playwright";
import { getAppDataDirectory } from "../../../session/services/session-database";
import { getOpenCodeRuntimeEnvironment } from "../opencode-runtime.config";
import { chatContextSystemPrompt } from "../opencode-chat-runtime.service";
import { getAuthenticationRuntimeId } from "../../../authentication/services/authentication-runtime";
import { pageInspectionAuthenticationSelectionService } from "../../../page-inspection/services/page-inspection-authentication-selection.service";

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
    expect(environment.NULLTRACE_RUNTIME_ID).toBe(getAuthenticationRuntimeId());
  });

  it("preserves the parent Playwright browser cache for the isolated chat runtime", () => {
    const environment = getOpenCodeRuntimeEnvironment();

    expect(environment.PLAYWRIGHT_BROWSERS_PATH).toBe(
      process.env.PLAYWRIGHT_BROWSERS_PATH ?? getDefaultPlaywrightBrowsersPath(),
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
    expect(environment.NULLTRACE_PAGE_INSPECTION_SESSION_IDS).toBe("[]");
    expect(environment.NULLTRACE_PAGE_INSPECTION_AUTH_SELECTIONS).toBe("{}");
    expect(chatContextSystemPrompt).toContain("inspect_page");
    expect(chatContextSystemPrompt).toContain("operator has explicitly selected");
  });

  it("transfers each selected authentication context to one isolated runtime launch", () => {
    pageInspectionAuthenticationSelectionService.select("session-one", 7);

    const firstEnvironment = getOpenCodeRuntimeEnvironment();
    const secondEnvironment = getOpenCodeRuntimeEnvironment();

    expect(firstEnvironment.NULLTRACE_PAGE_INSPECTION_AUTH_SELECTIONS).toBe(
      '{"session-one":7}',
    );
    expect(secondEnvironment.NULLTRACE_PAGE_INSPECTION_AUTH_SELECTIONS).toBe("{}");
  });

  it("guides chat to create FFUF action drafts", () => {
    expect(chatContextSystemPrompt).toContain("nmap, nuclei, or ffuf");
    expect(chatContextSystemPrompt).toContain("create_action_draft");
  });
});
