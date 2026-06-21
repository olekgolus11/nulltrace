import { mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { createHash } from "node:crypto";
import { join } from "node:path";
import { getAppDataDirectory } from "../../session/services/session-database";

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
  const inheritedEnvironment = Object.fromEntries(
    Object.entries(process.env).filter(
      ([name]) => !name.startsWith("OPENCODE_"),
    ),
  );

  return {
    ...inheritedEnvironment,
    HOME: runtimeHome,
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
