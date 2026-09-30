import { ToolPrepareCommand, ToolPreparedIsolatedRun } from "../../shared/types/tool-screen.types";
import { getCurlFieldOrder } from "../config/curl.config";
import {
  CurlBodyMode,
  CurlFormState,
  CurlHttpMethod,
  CurlToolData,
  CurlValidatedCommand,
} from "../types/curl.types";
import { curlBrokerExecutionService } from "./curl-broker-execution.service";
import {
  hasContentTypeHeader,
  normalizeCurlMethod,
  quoteCurlShellValue,
  readCurlHeaders,
  redactCurlCommand,
  validateCurlCommand,
  validateCurlRequestBodySize,
} from "./curl-command.helpers";

interface CurlCommandDependencies {
  isolatedRunService: Pick<typeof curlBrokerExecutionService, "prepare">;
}

class CurlCommandService {
  constructor(
    private readonly dependencies: CurlCommandDependencies = {
      isolatedRunService: curlBrokerExecutionService,
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
  }: ToolPrepareCommand): Promise<ToolPreparedIsolatedRun> {
    if (!targetUrl) throw new Error("cURL requires an active session target.");
    let validated: CurlValidatedCommand;
    try {
      validated = validateCurlCommand(command, targetUrl);
    } catch (error) {
      if (error instanceof Error && [
        "cURL request body cannot exceed 256 KiB.",
        "A cURL request must contain exactly one target URL.",
      ].includes(error.message)) throw error;
      throw new Error("cURL command is invalid or contains unsupported input.");
    }
    const curlToolData = toolData as CurlToolData | undefined;
    if (curlToolData?.form.bodyMode === "json" && curlToolData.form.body.trim()) {
      try {
        JSON.parse(curlToolData.form.body);
      } catch {
        throw new Error("cURL JSON body must contain valid JSON.");
      }
    }
    validateCurlRequestBodySize(curlToolData?.form.body ?? "");
    return this.dependencies.isolatedRunService.prepare(command, targetUrl, curlToolData);
  }

  redactCommandForPersistence(command: string) {
    return redactCurlCommand(command);
  }

  getSafeExecutionError(error: unknown): string | null {
    const message = error instanceof Error ? error.message : "";
    const safeMessages = new Set([
      "Authenticated cURL is unavailable with the isolated public worker at this stage.",
      "Isolated cURL broker is not configured. Set NULLTRACE_EXECUTION_BROKER_DIR to its private directory.",
      "Isolated cURL broker configuration is missing or invalid. Set NULLTRACE_EXECUTION_BROKER_DIR to a provisioned private directory.",
      "cURL requires an active session target.",
      "cURL command is invalid or contains unsupported input.",
      "cURL JSON body must contain valid JSON.",
      "cURL request body cannot exceed 256 KiB.",
      "A cURL request must contain exactly one target URL.",
      "Isolated cURL broker execution failed.",
      "Isolated cURL cleanup could not be confirmed.",
      "Isolated cURL request timed out.",
      "Broker cleanup remains unconfirmed.",
    ]);
    return safeMessages.has(message) ? message : null;
  }
}

export const curlCommandService = new CurlCommandService();
