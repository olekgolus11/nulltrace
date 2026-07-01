import { describe, expect, it } from "bun:test";
import { getAppDataDirectory } from "../../../session/services/session-database";
import { getOpenCodeRuntimeEnvironment } from "../opencode-runtime.config";

describe("getOpenCodeRuntimeEnvironment", () => {
  it("preserves the app database location for chat context tools", () => {
    const environment = getOpenCodeRuntimeEnvironment();

    expect(environment.XDG_DATA_HOME).not.toBe(getAppDataDirectory());
    expect(environment.NULLTRACE_APP_DATA_DIR).toBe(getAppDataDirectory());
  });
});
