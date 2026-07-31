import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, statSync } from "node:fs";
import { dirname, join } from "node:path";
import { getAppDataDirectory } from "../../../session/services/session-database";
import { normalizeExactOrigin } from "../../../authentication/services/authenticated-request-context.service";
import { ToolRunArtifactInput } from "../../../session/model/session.repository.types";
import {
  ToolPrepareCommand,
  ToolRunCompleted,
  ToolRunConfirmation,
} from "../../shared/types/tool-screen.types";
import {
  getNiktoFieldOrder,
  niktoDefaultCustomTuning,
  niktoDefaultRequestTimeoutSeconds,
  niktoDefaultTimeoutSeconds,
  niktoMaximumPauseSeconds,
  niktoMaximumRequestTimeoutSeconds,
  niktoMaximumTimeoutSeconds,
} from "../config/nikto.config";
import {
  NiktoFormState,
  NiktoProfile,
  NiktoToolData,
  NiktoTuningCode,
} from "../types/nikto.types";
import {
  assertNiktoCommand,
  isNiktoCommandDisruptive,
  parseNiktoJsonReport,
  quoteNiktoShellValue,
} from "./nikto-command.helpers";
import {
  redactNiktoCommandForPersistence,
  validateAuthenticatedNiktoCommand,
} from "./nikto-authenticated-command.helpers";
import { niktoAuthenticatedRunService } from "./nikto-authenticated-run.service";

const controlledOutputPattern =
  /\s+(?:-o|-output|-Format|-format)(?:\s+|=)(?:"[^"]*"|'[^']*'|\S+)/gi;
const controlledRequestPattern =
  /\s+(?:-timeout|-Pause)(?:\s+|=)(?:"[^"]*"|'[^']*'|\S+)/gi;

class NiktoCommandService {
  createInitialToolData(targetUrl: string): NiktoToolData {
    return {
      selectedField: 0,
      form: {
        target: targetUrl,
        rootPath: "",
        vhost: "",
        timeoutSeconds: String(niktoDefaultTimeoutSeconds),
        requestTimeoutSeconds: String(niktoDefaultRequestTimeoutSeconds),
        pauseSeconds: "0",
        profile: "standard",
        tuning: [...niktoDefaultCustomTuning],
        useAuthenticatedContext: false,
      },
      authentication: {
        strategy: "none",
        isAvailable: false,
        origin: null,
      },
    };
  }

  buildCommand(toolData: NiktoToolData) {
    const {
      target,
      rootPath,
      vhost,
      timeoutSeconds,
      requestTimeoutSeconds,
      pauseSeconds,
      profile,
      tuning,
    } = toolData.form;
    const command = ["nikto", "-h", quoteNiktoShellValue(target.trim())];
    if (profile === "standard") {
      command.push("-Tuning", quoteNiktoShellValue("x6"));
    } else {
      const selectedTuning = tuning.length > 0
        ? tuning.join("")
        : niktoDefaultCustomTuning.join("");
      command.push("-Tuning", quoteNiktoShellValue(selectedTuning));
      command.push(
        "-timeout",
        String(this.normalizeRequestTimeout(requestTimeoutSeconds)),
      );
      const pause = this.normalizePause(pauseSeconds);
      if (pause > 0) command.push("-Pause", String(pause));
    }
    if (rootPath.trim()) command.push("-root", quoteNiktoShellValue(rootPath.trim()));
    if (vhost.trim()) command.push("-vhost", quoteNiktoShellValue(vhost.trim()));
    command.push("-maxtime", `${this.normalizeTimeout(timeoutSeconds)}s`);
    return command.join(" ");
  }

  setField(toolData: NiktoToolData, field: keyof NiktoFormState, value: string): NiktoToolData {
    const updated = { ...toolData, form: { ...toolData.form, [field]: value } };
    return field === "target"
      ? this.setAuthenticationAvailability(updated, toolData.authentication.origin)
      : updated;
  }

  setAuthenticationAvailability(toolData: NiktoToolData, origin: string | null): NiktoToolData {
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
        : Math.min(
            toolData.selectedField,
            getNiktoFieldOrder(toolData.form.profile).length - 1,
          ),
      form: {
        ...toolData.form,
        useAuthenticatedContext: isAvailable
          ? toolData.form.useAuthenticatedContext
          : false,
      },
      authentication: {
        strategy:
          isAvailable && toolData.form.useAuthenticatedContext ? "session" : "none",
        isAvailable,
        origin,
      },
    };
  }

  toggleAuthenticatedContext(toolData: NiktoToolData): NiktoToolData {
    if (!toolData.authentication.isAvailable) return toolData;
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

  resetRunScopedState(toolData: NiktoToolData): NiktoToolData {
    return {
      ...toolData,
      form: {
        ...toolData.form,
        useAuthenticatedContext: false,
      },
      authentication: {
        ...toolData.authentication,
        strategy: "none",
      },
    };
  }

  setProfile(toolData: NiktoToolData, profile: NiktoProfile): NiktoToolData {
    return {
      ...toolData,
      selectedField: 0,
      form: {
        ...toolData.form,
        profile,
      },
    };
  }

  cycleProfile(toolData: NiktoToolData): NiktoToolData {
    return this.setProfile(
      toolData,
      toolData.form.profile === "standard" ? "custom" : "standard",
    );
  }

  toggleTuning(toolData: NiktoToolData, code: NiktoTuningCode): NiktoToolData {
    if (toolData.form.tuning.length === 1 && toolData.form.tuning[0] === code) {
      return toolData;
    }
    const tuning = toolData.form.tuning.includes(code)
      ? toolData.form.tuning.filter((item) => item !== code)
      : [...toolData.form.tuning, code];
    return {
      ...toolData,
      form: {
        ...toolData.form,
        tuning,
      },
    };
  }

  moveSelection(toolData: NiktoToolData, delta: -1 | 1): NiktoToolData {
    const maximumIndex = getNiktoFieldOrder(
      toolData.form.profile,
      toolData.authentication.isAvailable,
    ).length - 1;
    return {
      ...toolData,
      selectedField: Math.max(0, Math.min(toolData.selectedField + delta, maximumIndex)),
    };
  }

  redactCommandForPersistence(command: string) {
    return redactNiktoCommandForPersistence(command);
  }

  getRunConfirmation(
    command: string,
    toolData: NiktoToolData,
  ): ToolRunConfirmation | null {
    if (toolData.form.profile !== "custom") {
      return null;
    }
    try {
      if (!isNiktoCommandDisruptive(command)) {
        return null;
      }
    } catch {
      return null;
    }
    return {
      title: "Confirm disruptive Nikto checks",
      message:
        "Selected tuning includes denial-of-service checks. Confirm only for an authorized target.",
      confirmationKey: "y",
    };
  }

  prepareCommandForRun({ command, sessionId, toolRunId, toolData }: ToolPrepareCommand) {
    const data = toolData as NiktoToolData | undefined;
    const profile = data?.form.profile ?? "standard";
    assertNiktoCommand(command, profile);
    if (!sessionId || !toolRunId) return command;

    const outputPrefix = this.getOutputPrefix(sessionId, toolRunId);
    mkdirSync(dirname(outputPrefix), { recursive: true });
    const timeout = this.normalizeTimeout(
      (toolData as NiktoToolData | undefined)?.form.timeoutSeconds,
    );
    const controlled = command
      .replace(controlledOutputPattern, " ")
      .replace(controlledRequestPattern, " ")
      .replace(/\s+-maxtime(?:\s+|=)\S+/gi, " ")
      .trim();
    const requestControls =
      profile === "custom"
        ? [
            "-timeout",
            String(this.normalizeRequestTimeout(data?.form.requestTimeoutSeconds)),
            ...(this.normalizePause(data?.form.pauseSeconds) > 0
              ? ["-Pause", String(this.normalizePause(data?.form.pauseSeconds))]
              : []),
          ]
        : [];
    const controlledCommand = [
      controlled,
      ...requestControls,
      "-maxtime",
      `${timeout}s`,
      "-Format",
      "json",
      "-output",
      quoteNiktoShellValue(outputPrefix),
    ].join(" ");
    if (!data?.form.useAuthenticatedContext) {
      return controlledCommand;
    }

    const authenticatedTarget = validateAuthenticatedNiktoCommand(command);
    return niktoAuthenticatedRunService.prepare({
      sessionId,
      targetUrl: authenticatedTarget,
      command: controlledCommand,
      artifactOutputPath: this.getJsonOutputPath(sessionId, toolRunId),
    }).then((prepared) => ({
      command: prepared.command,
      cleanup: prepared.cleanup,
      prepareArtifacts: prepared.prepareArtifacts,
      redactOutput: prepared.redactOutput,
      redactArtifact: prepared.redactArtifact,
    }));
  }

  async collectArtifacts(options: ToolRunCompleted): Promise<ToolRunArtifactInput[]> {
    const { sessionId, toolRunId, status, exitCode, toolData } = options;
    if (!sessionId || !toolRunId || status === "cancelled") return [];
    const profile = (toolData as NiktoToolData | undefined)?.form.profile ?? "standard";
    const outputPath = this.getExistingOutputPath(sessionId, toolRunId);
    if (!existsSync(outputPath)) {
      return [this.buildReportArtifact(status, exitCode, null, {
        findings: [],
        rejectedItemCount: 0,
        parseWarning: "Nikto did not produce a JSON report.",
      }, profile)];
    }
    const content = readFileSync(outputPath, "utf8");
    if (!content.trim()) {
      return [this.buildReportArtifact(status, exitCode, null, {
        findings: [],
        rejectedItemCount: 0,
        parseWarning: "Nikto produced an empty JSON report.",
      }, profile)];
    }
    const requestedTarget = (toolData as NiktoToolData | undefined)?.form.target;
    const report = parseNiktoJsonReport(content, requestedTarget);

    return [this.buildReportArtifact(status, exitCode, {
      format: "nikto_json",
      path: outputPath,
      bytes: statSync(outputPath).size,
      sha256: createHash("sha256").update(content).digest("hex"),
    }, report, profile)];
  }

  private buildReportArtifact(
    status: ToolRunCompleted["status"],
    exitCode: number | null,
    source: Record<string, unknown> | null,
    report: ReturnType<typeof parseNiktoJsonReport>,
    profile: NiktoProfile = "standard",
  ): ToolRunArtifactInput {
    return {
      artifactType: "nikto_report",
      label: `Nikto ${profile === "custom" ? "Custom" : "Standard"} report`,
      source: "nikto.json",
      payload: {
        source,
        runContext: { profile, status, exitCode },
        findings: report.findings,
        rejectedItemCount: report.rejectedItemCount,
        parseWarning: report.parseWarning,
      },
    };
  }

  private normalizeTimeout(value: string | undefined) {
    const parsed = Number.parseInt(value ?? "", 10);
    if (!Number.isFinite(parsed)) return niktoDefaultTimeoutSeconds;
    return Math.max(1, Math.min(parsed, niktoMaximumTimeoutSeconds));
  }

  private normalizeRequestTimeout(value: string | undefined) {
    const parsed = Number.parseInt(value ?? "", 10);
    if (!Number.isFinite(parsed)) return niktoDefaultRequestTimeoutSeconds;
    return Math.max(1, Math.min(parsed, niktoMaximumRequestTimeoutSeconds));
  }

  private normalizePause(value: string | undefined) {
    const parsed = Number.parseInt(value ?? "", 10);
    if (!Number.isFinite(parsed)) return 0;
    return Math.max(0, Math.min(parsed, niktoMaximumPauseSeconds));
  }

  private getOutputPrefix(sessionId: string, toolRunId: string) {
    return join(
      getAppDataDirectory(),
      "artifacts",
      "sessions",
      sessionId,
      "tool-runs",
      toolRunId,
      "nikto",
    );
  }

  private getExistingOutputPath(sessionId: string, toolRunId: string) {
    const outputPrefix = this.getOutputPrefix(sessionId, toolRunId);
    const jsonOutputPath = `${outputPrefix}.json`;
    return existsSync(jsonOutputPath) ? jsonOutputPath : outputPrefix;
  }

  private getJsonOutputPath(sessionId: string, toolRunId: string) {
    return `${this.getOutputPrefix(sessionId, toolRunId)}.json`;
  }
}

export const niktoCommandService = new NiktoCommandService();
