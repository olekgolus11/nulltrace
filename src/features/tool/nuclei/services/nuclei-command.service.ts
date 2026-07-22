import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, statSync } from "node:fs";
import { dirname, join } from "node:path";
import {
  nucleiFieldOrder,
  nucleiSeverityCliValues,
  nucleiSeverityOptions,
} from "../config/nuclei.config";
import { getAppDataDirectory } from "../../../session/services/session-database";
import { ToolRunArtifactInput } from "../../../session/model/session.repository.types";
import {
  ToolPrepareCommand,
  ToolPreparedCommand,
  ToolRunCompleted,
} from "../../shared/types/tool-screen.types";
import {
  NucleiFieldId,
  NucleiFormState,
  NucleiSeverityPreset,
  NucleiToolData,
} from "../types/nuclei.types";
import { normalizeExactOrigin } from "../../../authentication/services/authenticated-request-context.service";
import { nucleiAuthenticatedRunService } from "./nuclei-authenticated-run.service";
import { redactNucleiCommandForPersistence } from "./nuclei-command-redaction.helpers";
import {
  hasNucleiNoColorFlag,
  parseNucleiJsonl,
  stripNucleiOutputFlags,
  validateAuthenticatedNucleiCommand,
} from "./nuclei-command.helpers";
import { shellQuote } from "./nuclei-shell.helpers";

class NucleiCommandService {
  private getJsonlOutputPath(sessionId: string, toolRunId: string) {
    return join(
      getAppDataDirectory(),
      "artifacts",
      "sessions",
      sessionId,
      "tool-runs",
      toolRunId,
      "nuclei.jsonl",
    );
  }

  private extractTarget(targetUrl: string) {
    return targetUrl.trim();
  }

  createInitialToolData(targetUrl: string): NucleiToolData {
    return {
      selectedField: 0,
      form: {
        target: this.extractTarget(targetUrl),
        severityPreset: "all",
        tags: "",
        templatesPath: "",
        extraArgs: "",
        useAuthenticatedContext: false,
      },
      authentication: {
        strategy: "none",
        isAvailable: false,
        origin: null,
      },
      future: {
        headers: {
          entries: [],
        },
        templateManagement: {
          source: "external",
        },
      },
    };
  }

  buildCommand(toolData: NucleiToolData) {
    const form = toolData.form;
    const cmd: string[] = ["nuclei"];

    if (form.target.trim()) {
      cmd.push("-u", form.target.trim());
    }

    if (form.severityPreset !== "all") {
      cmd.push("-severity", nucleiSeverityCliValues[form.severityPreset]);
    }

    if (form.tags.trim()) {
      cmd.push("-tags", form.tags.trim());
    }

    if (form.templatesPath.trim()) {
      cmd.push("-t", form.templatesPath.trim());
    }

    if (form.extraArgs.trim()) {
      cmd.push(form.extraArgs.trim());
    }

    return cmd.join(" ").trim();
  }

  setAuthenticationAvailability(toolData: NucleiToolData, origin: string | null): NucleiToolData {
    let isAvailable = false;
    try {
      isAvailable = Boolean(origin && normalizeExactOrigin(toolData.form.target) === origin);
    } catch {
      isAvailable = false;
    }
    return {
      ...toolData,
      selectedField: isAvailable
        ? toolData.selectedField
        : Math.min(toolData.selectedField, nucleiFieldOrder.length - 2),
      form: {
        ...toolData.form,
        useAuthenticatedContext: isAvailable ? toolData.form.useAuthenticatedContext : false,
      },
      authentication: {
        strategy: isAvailable && toolData.form.useAuthenticatedContext ? "session" : "none",
        isAvailable,
        origin,
      },
    };
  }

  toggleAuthenticatedContext(toolData: NucleiToolData): NucleiToolData {
    if (!toolData.authentication.isAvailable) {
      return toolData;
    }
    const useAuthenticatedContext = !toolData.form.useAuthenticatedContext;
    return {
      ...toolData,
      form: {
        ...toolData.form,
        useAuthenticatedContext,
      },
      authentication: {
        ...toolData.authentication,
        strategy: useAuthenticatedContext ? "session" : "none",
      },
    };
  }

  setField(
    toolData: NucleiToolData,
    field: keyof NucleiFormState,
    value: string | NucleiSeverityPreset,
  ): NucleiToolData {
    const updated = {
      ...toolData,
      form: {
        ...toolData.form,
        [field]: value,
      },
    };
    return field === "target"
      ? this.setAuthenticationAvailability(updated, toolData.authentication.origin)
      : updated;
  }

  moveSelection(toolData: NucleiToolData, delta: -1 | 1, max: number): NucleiToolData {
    return {
      ...toolData,
      selectedField: Math.max(0, Math.min(toolData.selectedField + delta, max)),
    };
  }

  cycleSeverity(toolData: NucleiToolData, delta: -1 | 1): NucleiToolData {
    const currentIndex = nucleiSeverityOptions.indexOf(toolData.form.severityPreset);
    const nextIndex =
      (currentIndex + delta + nucleiSeverityOptions.length) % nucleiSeverityOptions.length;

    return {
      ...toolData,
      form: {
        ...toolData.form,
        severityPreset: nucleiSeverityOptions[nextIndex]!,
      },
    };
  }

  isSeverityFieldSelected(field: NucleiFieldId | undefined) {
    return field === "severityPreset";
  }

  isAuthenticationFieldSelected(field: NucleiFieldId | undefined) {
    return field === "useAuthenticatedContext";
  }

  getFieldCount() {
    return nucleiFieldOrder.length;
  }

  redactCommandForPersistence(command: string) {
    return redactNucleiCommandForPersistence(command);
  }

  async prepareCommandForRun(options: ToolPrepareCommand): Promise<string | ToolPreparedCommand> {
    const { command, sessionId, toolRunId } = options;

    if (!sessionId || !toolRunId) {
      return command;
    }

    const jsonlOutputPath = this.getJsonlOutputPath(sessionId, toolRunId);
    const outputDirectory = dirname(jsonlOutputPath);
    mkdirSync(outputDirectory, { recursive: true });

    const strippedCommand = stripNucleiOutputFlags(command);
    const colorSafeCommand = hasNucleiNoColorFlag(strippedCommand)
      ? strippedCommand
      : strippedCommand + " -nc";
    const jsonlOutputFlags = ` -jsonl-export ${shellQuote(jsonlOutputPath)}`;
    const controlledCommand = colorSafeCommand + jsonlOutputFlags;
    const toolData = options.toolData as NucleiToolData | null | undefined;
    if (!toolData?.form.useAuthenticatedContext) {
      return controlledCommand;
    }

    const authenticatedTarget = validateAuthenticatedNucleiCommand(command);
    const prepared = await nucleiAuthenticatedRunService.prepare({
      sessionId,
      targetUrl: authenticatedTarget,
      command: `${controlledCommand} -omit-raw -disable-redirects -disable-unsigned-templates`,
    });
    return {
      command: prepared.command,
      cleanup: prepared.cleanup,
    };
  }

  async collectArtifacts(options: ToolRunCompleted): Promise<ToolRunArtifactInput[]> {
    const { sessionId, toolRunId, status, exitCode } = options;

    if (!sessionId || !toolRunId || status === "cancelled") {
      return [];
    }

    const jsonlOutputPath = this.getJsonlOutputPath(sessionId, toolRunId);
    if (!existsSync(jsonlOutputPath)) {
      return [];
    }

    const jsonl = readFileSync(jsonlOutputPath, "utf8");
    if (!jsonl.trim()) {
      return [];
    }

    const parsed = parseNucleiJsonl(jsonl);
    if (parsed.findings.length === 0) {
      return [];
    }

    return [
      {
        artifactType: "nuclei_findings",
        label: "Nuclei findings",
        source: "nuclei.jsonl",
        payload: {
          source: this.buildJsonlSourceMetadata(jsonlOutputPath, jsonl),
          scanner: {
            name: "nuclei",
            status,
            exitCode,
          },
          parseErrorCount: parsed.parseErrorCount,
          findings: parsed.findings,
        },
      },
    ];
  }

  private buildJsonlSourceMetadata(path: string, jsonl: string) {
    return {
      format: "nuclei_jsonl",
      path,
      bytes: statSync(path).size,
      sha256: createHash("sha256").update(jsonl).digest("hex"),
    };
  }
}

export const nucleiCommandService = new NucleiCommandService();
