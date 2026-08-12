import { chmodSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { getAppDataDirectory } from "../../../session/services/session-database";
import {
  ToolPrepareCommand,
  ToolPreparedCommand,
} from "../../shared/types/tool-screen.types";
import {
  curlMaximumResponseBytes,
  curlMaximumRedirectCount,
  curlRequestTimeoutSeconds,
  getCurlFieldOrder,
} from "../config/curl.config";
import {
  CurlBodyMode,
  CurlFormState,
  CurlHttpMethod,
  CurlToolData,
} from "../types/curl.types";
import { curlAuthenticatedRunService } from "./curl-authenticated-run.service";
import {
  normalizeCurlMethod,
  quoteCurlShellValue,
  redactCurlCommand,
  validateCurlCommand,
  validateCurlRequestBodySize,
} from "./curl-command.helpers";
import { CurlExecutionInput } from "./curl-execution.types";

interface CurlCommandDependencies {
  authenticatedRunService: Pick<typeof curlAuthenticatedRunService, "prepare">;
}

class CurlCommandService {
  constructor(
    private readonly dependencies: CurlCommandDependencies = {
      authenticatedRunService: curlAuthenticatedRunService,
    },
  ) {}

  createInitialToolData(targetUrl: string): CurlToolData {
    return {
      selectedField: 0,
      authentication: {
        strategy: "none",
        isAvailable: false,
        origin: null,
      },
      form: {
        method: "GET",
        targetUrl,
        headers: "Accept: */*",
        bodyMode: "text",
        body: "",
        useAuthenticatedContext: false,
      },
    };
  }

  buildCommand(toolData: CurlToolData) {
    const { form } = toolData;
    const command = [
      "curl",
      "-X",
      form.method,
      quoteCurlShellValue(form.targetUrl.trim()),
    ];
    for (const header of readCurlHeaders(form.headers)) {
      command.push("-H", quoteCurlShellValue(header));
    }
    if (form.body) {
      if (form.bodyMode === "json" && !hasContentTypeHeader(form.headers)) {
        command.push("-H", quoteCurlShellValue("Content-Type: application/json"));
      }
      command.push("--data-raw", quoteCurlShellValue(form.body));
    }
    return command.join(" ");
  }

  setField<K extends keyof CurlFormState>(
    toolData: CurlToolData,
    field: K,
    value: CurlFormState[K],
  ): CurlToolData {
    const nextValue = field === "method" ? normalizeCurlMethod(String(value)) : value;
    const next = {
      ...toolData,
      form: { ...toolData.form, [field]: nextValue },
    };
    return field === "targetUrl"
      ? this.setAuthenticationAvailability(next, toolData.authentication.origin)
      : next;
  }

  moveSelection(toolData: CurlToolData, delta: -1 | 1): CurlToolData {
    return {
      ...toolData,
      selectedField: Math.max(
        0,
        Math.min(
          toolData.selectedField + delta,
          getCurlFieldOrder(toolData.authentication.isAvailable).length - 1,
        ),
      ),
    };
  }

  cycleMethod(toolData: CurlToolData, delta: -1 | 1): CurlToolData {
    const methods: readonly CurlHttpMethod[] = [
      "GET",
      "HEAD",
      "POST",
      "PUT",
      "PATCH",
      "DELETE",
      "OPTIONS",
    ];
    const current = methods.indexOf(toolData.form.method);
    return this.setField(
      toolData,
      "method",
      methods[(current + delta + methods.length) % methods.length] ?? "GET",
    );
  }

  cycleBodyMode(toolData: CurlToolData): CurlToolData {
    const bodyMode: CurlBodyMode = toolData.form.bodyMode === "text" ? "json" : "text";
    return this.setField(toolData, "bodyMode", bodyMode);
  }

  setAuthenticationAvailability(toolData: CurlToolData, origin: string | null): CurlToolData {
    let isAvailable = false;
    try {
      isAvailable = Boolean(origin && new URL(toolData.form.targetUrl).origin === origin);
    } catch {
      isAvailable = false;
    }
    const useAuthenticatedContext = isAvailable
      ? toolData.form.useAuthenticatedContext
      : false;
    return {
      ...toolData,
      selectedField: Math.min(
        toolData.selectedField,
        getCurlFieldOrder(isAvailable).length - 1,
      ),
      form: { ...toolData.form, useAuthenticatedContext },
      authentication: {
        strategy: useAuthenticatedContext ? "session" : "none",
        isAvailable,
        origin,
      },
    };
  }

  toggleAuthenticatedContext(toolData: CurlToolData): CurlToolData {
    if (!toolData.authentication.isAvailable) return toolData;
    const useAuthenticatedContext = !toolData.form.useAuthenticatedContext;
    return {
      ...toolData,
      form: { ...toolData.form, useAuthenticatedContext },
      authentication: {
        ...toolData.authentication,
        strategy: useAuthenticatedContext ? "session" : "none",
      },
    };
  }

  resetRunScopedState(toolData: CurlToolData): CurlToolData {
    return {
      ...toolData,
      form: { ...toolData.form, useAuthenticatedContext: false },
      authentication: { ...toolData.authentication, strategy: "none" },
    };
  }

  async prepareCommandForRun({
    command,
    sessionId,
    targetUrl,
    toolData,
  }: ToolPrepareCommand): Promise<ToolPreparedCommand> {
    if (!targetUrl) throw new Error("cURL requires an active session target.");
    const validated = validateCurlCommand(command, targetUrl);
    const curlToolData = toolData as CurlToolData | undefined;
    if (curlToolData?.form.bodyMode === "json" && curlToolData.form.body.trim()) {
      try {
        JSON.parse(curlToolData.form.body);
      } catch {
        throw new Error("cURL JSON body must contain valid JSON.");
      }
    }
    validateCurlRequestBodySize(curlToolData?.form.body ?? "");
    if (curlToolData?.form.useAuthenticatedContext && !sessionId) {
      throw new Error("Authenticated cURL runs require an active persisted session.");
    }
    const authenticated = curlToolData?.form.useAuthenticatedContext
      ? await this.dependencies.authenticatedRunService.prepare({
          sessionId: sessionId!,
          targetUrl: validated.targetUrl,
          command: command.trim(),
        })
      : null;
    let executionDirectory: string | null = null;
    try {
      const rootDirectory = join(getAppDataDirectory(), "run-secrets");
      mkdirSync(rootDirectory, { recursive: true, mode: 0o700 });
      chmodSync(rootDirectory, 0o700);
      executionDirectory = mkdtempSync(join(rootDirectory, "curl-execution-"));
      chmodSync(executionDirectory, 0o700);
      const executionPath = join(executionDirectory, "execution.json");
      const sessionOrigin = new URL(targetUrl).origin;
      const input: CurlExecutionInput = {
        tokens: validated.tokens,
        method: validated.method,
        targetUrl: validated.targetUrl,
        exactOrigin: sessionOrigin,
        authenticationConfigPath: authenticated?.configPath ?? null,
        maximumRedirectCount: curlMaximumRedirectCount,
        maximumResponseBytes: curlMaximumResponseBytes,
        timeoutSeconds: curlRequestTimeoutSeconds,
      };
      writeFileSync(executionPath, JSON.stringify(input), {
        encoding: "utf8",
        flag: "wx",
        mode: 0o600,
      });
      chmodSync(executionPath, 0o600);
      const runnerPath = join(import.meta.dir, "curl-execution-runner.ts");
      const cleanup = () => {
        try {
          authenticated?.cleanup();
        } finally {
          if (executionDirectory) {
            rmSync(executionDirectory, { recursive: true, force: true });
            executionDirectory = null;
          }
        }
      };
      return {
        command: `${quoteCurlShellValue(process.execPath)} ${quoteCurlShellValue(runnerPath)} ${quoteCurlShellValue(executionPath)}`,
        timeoutMs: curlRequestTimeoutSeconds * 1000,
        systemLines: [
          `[redirect policy: up to ${curlMaximumRedirectCount}, exact session origin only]`,
          ...(authenticated
            ? [`[session authentication applied: ${authenticated.authenticationOrigin}]`]
            : []),
        ],
        cleanup,
        ...(authenticated ? { redactOutput: authenticated.redactOutput } : {}),
      };
    } catch (error) {
      authenticated?.cleanup();
      if (executionDirectory) {
        rmSync(executionDirectory, { recursive: true, force: true });
      }
      throw error;
    }
  }

  redactCommandForPersistence(command: string) {
    return redactCurlCommand(command);
  }
}

export const curlCommandService = new CurlCommandService();

function readCurlHeaders(value: string) {
  return value
    .split(/\r?\n/)
    .map((header) => header.trim())
    .filter(Boolean);
}

function hasContentTypeHeader(value: string) {
  return readCurlHeaders(value).some((header) => /^content-type\s*:/i.test(header));
}
