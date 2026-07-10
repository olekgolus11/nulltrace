import { describe, expect, it } from "bun:test";
import { getAppDataDirectory } from "../../../session/services/session-database";
import { getOpenCodeRuntimeEnvironment } from "../opencode-runtime.config";

describe("getOpenCodeRuntimeEnvironment", () => {
  it("preserves the app database location for chat context tools", () => {
    const environment = getOpenCodeRuntimeEnvironment();

    expect(environment.XDG_DATA_HOME).not.toBe(getAppDataDirectory());
    expect(environment.NULLTRACE_APP_DATA_DIR).toBe(getAppDataDirectory());
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
});
