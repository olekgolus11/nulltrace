import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { createHash } from "node:crypto";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { getAppDataDirectory } from "../../session/services/session-database";
import { getAuthenticationRuntimeId } from "../../authentication/services/authentication-runtime";
import { getMacOSLoginKeychainPath } from "../../authentication/services/platform-secret-store.helpers";
import { pageInspectionPermissionService } from "../../page-inspection/services/page-inspection-permission.service";
import { getPlaywrightBrowsersPath } from "../../page-inspection/services/playwright-page-inspection-browser.helpers";
import { chatContextToolRegistry, createOpenCodeToolSource } from "./chat-context-tools.service";

const runtimeRoot = join(getAppDataDirectory(), "chat-runtime");
const runtimeHome = join(runtimeRoot, "home");
const runtimeConfig = join(runtimeRoot, "config");
const runtimeData = join(runtimeRoot, "data");
const runtimeState = join(runtimeRoot, "state");
const runtimeCache = join(runtimeRoot, "cache");
const workspacesRoot = join(runtimeRoot, "workspaces");
const selectedModelPath = join(runtimeRoot, "selected-model.json");

export interface SelectedOpenCodeModel {
  providerID: string;
  modelID: string;
}

const openCodeConfig = {
  autoupdate: false,
  formatter: false,
  instructions: [],
  lsp: false,
  mcp: {},
  permission: {
    "*": "deny",
    get_session_context: "allow",
    get_authentication_context: "allow",
    get_finding: "allow",
    list_findings: "allow",
    list_tool_runs: "allow",
    get_tool_run_logs: "allow",
    get_artifact: "allow",
    get_active_tool_workspace: "allow",
    list_available_scanner_tools: "allow",
    get_sitemap_status: "allow",
    list_sitemap_entries: "allow",
    search_sitemap_entries: "allow",
    get_sitemap_entry: "allow",
    create_action_draft: "allow",
    inspect_page: "allow",
    webfetch: "allow",
    websearch: "allow",
  },
  plugin: [],
  share: "disabled",
  tools: {
    bash: false,
    edit: false,
    glob: false,
    grep: false,
    list: false,
    patch: false,
    read: false,
    skill: false,
    task: false,
    webfetch: true,
    websearch: true,
    write: false,
  },
} as const;

const repoRoot = fileURLToPath(new URL("../../../../", import.meta.url));
const chatContextToolsImportPath = join(
  repoRoot,
  "src/features/chat/services/chat-context-tools.service.ts",
);
const openCodePluginImportPath = join(repoRoot, "node_modules/@opencode-ai/plugin/dist/index.js");

function ensureSessionChatContextTools(workspace: string) {
  const toolsDirectory = join(workspace, ".opencode", "tools");
  mkdirSync(toolsDirectory, { recursive: true });

  for (const definition of chatContextToolRegistry.listDefinitions()) {
    const toolPath = join(toolsDirectory, `${definition.name}.ts`);
    const source = createOpenCodeToolSource(definition.name);

    if (!existsSync(toolPath) || readFileSync(toolPath, "utf8") !== source) {
      writeFileSync(toolPath, source, "utf8");
    }
  }
}

export function ensureOpenCodeRuntimeDirectories() {
  for (const directory of [
    runtimeRoot,
    runtimeHome,
    runtimeConfig,
    runtimeData,
    runtimeState,
    runtimeCache,
    workspacesRoot,
    join(runtimeConfig, "opencode"),
  ]) {
    mkdirSync(directory, { recursive: true });
  }
}

export function getOpenCodeExecutable() {
  return process.env.OPENCODE_BIN || "opencode";
}

export function getOpenCodeRuntimeEnvironment() {
  ensureOpenCodeRuntimeDirectories();
  const playwrightBrowsersPath = getPlaywrightBrowsersPath();
  const inheritedEnvironment = Object.fromEntries(
    Object.entries(process.env).filter(([name]) => !name.startsWith("OPENCODE_")),
  );

  return {
    ...inheritedEnvironment,
    HOME: runtimeHome,
    NULLTRACE_APP_DATA_DIR: getAppDataDirectory(),
    NULLTRACE_CHAT_CONTEXT_TOOLS_IMPORT_PATH: chatContextToolsImportPath,
    NULLTRACE_OPENCODE_PLUGIN_IMPORT_PATH: openCodePluginImportPath,
    NULLTRACE_RUNTIME_ID: getAuthenticationRuntimeId(),
    NULLTRACE_PAGE_INSPECTION_MODES: JSON.stringify(pageInspectionPermissionService.listModes()),
    ...(process.platform === "darwin"
      ? { NULLTRACE_MACOS_KEYCHAIN_PATH: getMacOSLoginKeychainPath() }
      : {}),
    ...(playwrightBrowsersPath ? { PLAYWRIGHT_BROWSERS_PATH: playwrightBrowsersPath } : {}),
    OPENCODE_CONFIG_CONTENT: JSON.stringify(openCodeConfig),
    OPENCODE_CONFIG_DIR: join(runtimeConfig, "opencode"),
    XDG_CACHE_HOME: runtimeCache,
    XDG_CONFIG_HOME: runtimeConfig,
    XDG_DATA_HOME: runtimeData,
    XDG_STATE_HOME: runtimeState,
  };
}

export function getSessionChatWorkspace(sessionId: string) {
  ensureOpenCodeRuntimeDirectories();
  const workspaceId = createHash("sha256").update(sessionId).digest("hex");
  const workspace = join(workspacesRoot, workspaceId);
  mkdirSync(workspace, { recursive: true });
  ensureSessionChatContextTools(workspace);
  return workspace;
}

export function getOpenCodeRuntimeRoot() {
  ensureOpenCodeRuntimeDirectories();
  return runtimeRoot;
}

export function getSelectedOpenCodeModel(): SelectedOpenCodeModel | undefined {
  try {
    const value: unknown = JSON.parse(readFileSync(selectedModelPath, "utf8"));
    if (
      !value ||
      typeof value !== "object" ||
      !("providerID" in value) ||
      typeof value.providerID !== "string" ||
      !("modelID" in value) ||
      typeof value.modelID !== "string"
    ) {
      return undefined;
    }

    return {
      providerID: value.providerID,
      modelID: value.modelID,
    };
  } catch {
    return undefined;
  }
}

export function setSelectedOpenCodeModel(model: SelectedOpenCodeModel) {
  ensureOpenCodeRuntimeDirectories();
  const temporaryPath = `${selectedModelPath}.tmp`;
  writeFileSync(temporaryPath, `${JSON.stringify(model, null, 2)}\n`, "utf8");
  renameSync(temporaryPath, selectedModelPath);
}
