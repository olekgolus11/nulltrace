import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, statSync } from "node:fs";
import { dirname, join } from "node:path";
import { getAppDataDirectory } from "../../../session/services/session-database";
import { ToolRunArtifactInput } from "../../../session/model/session.repository.types";
import { ToolPrepareCommand, ToolRunCompleted } from "../../shared/types/tool-screen.types";
import {
  niktoDefaultTimeoutSeconds,
  niktoMaximumTimeoutSeconds,
} from "../config/nikto.config";
import { NiktoFormState, NiktoToolData } from "../types/nikto.types";
import {
  assertNiktoStandardCommand,
  parseNiktoJsonReport,
  quoteNiktoShellValue,
} from "./nikto-command.helpers";

const controlledOutputPattern =
  /\s+(?:-o|-output|-Format|-format)(?:\s+|=)(?:"[^"]*"|'[^']*'|\S+)/gi;

class NiktoCommandService {
  createInitialToolData(targetUrl: string): NiktoToolData {
    return {
      selectedField: 0,
      form: {
        target: targetUrl,
        rootPath: "",
        vhost: "",
        timeoutSeconds: String(niktoDefaultTimeoutSeconds),
        profile: "standard",
      },
    };
  }

  buildCommand(toolData: NiktoToolData) {
    const { target, rootPath, vhost, timeoutSeconds } = toolData.form;
    const command = ["nikto", "-h", quoteNiktoShellValue(target.trim())];
    if (rootPath.trim()) command.push("-root", quoteNiktoShellValue(rootPath.trim()));
    if (vhost.trim()) command.push("-vhost", quoteNiktoShellValue(vhost.trim()));
    command.push("-maxtime", `${this.normalizeTimeout(timeoutSeconds)}s`);
    return command.join(" ");
  }

  setField(toolData: NiktoToolData, field: keyof NiktoFormState, value: string): NiktoToolData {
    return { ...toolData, form: { ...toolData.form, [field]: value } };
  }

  moveSelection(toolData: NiktoToolData, delta: -1 | 1): NiktoToolData {
    return {
      ...toolData,
      selectedField: Math.max(0, Math.min(toolData.selectedField + delta, 3)),
    };
  }

  prepareCommandForRun({ command, sessionId, toolRunId, toolData }: ToolPrepareCommand) {
    assertNiktoStandardCommand(command);
    if (!sessionId || !toolRunId) return command;

    const outputPath = this.getOutputPath(sessionId, toolRunId);
    mkdirSync(dirname(outputPath), { recursive: true });
    const timeout = this.normalizeTimeout(
      (toolData as NiktoToolData | undefined)?.form.timeoutSeconds,
    );
    const controlled = command
      .replace(controlledOutputPattern, " ")
      .replace(/\s+-maxtime(?:\s+|=)\S+/gi, " ")
      .trim();
    return `${controlled} -maxtime ${timeout}s -Format json -output ${quoteNiktoShellValue(outputPath)}`;
  }

  async collectArtifacts(options: ToolRunCompleted): Promise<ToolRunArtifactInput[]> {
    const { sessionId, toolRunId, status, exitCode } = options;
    if (!sessionId || !toolRunId || status === "cancelled") return [];
    const outputPath = this.getOutputPath(sessionId, toolRunId);
    if (!existsSync(outputPath)) {
      return [this.buildReportArtifact(status, exitCode, null, {
        findings: [],
        rejectedItemCount: 0,
        parseWarning: "Nikto did not produce a JSON report.",
      })];
    }
    const content = readFileSync(outputPath, "utf8");
    if (!content.trim()) {
      return [this.buildReportArtifact(status, exitCode, null, {
        findings: [],
        rejectedItemCount: 0,
        parseWarning: "Nikto produced an empty JSON report.",
      })];
    }
    const report = parseNiktoJsonReport(content);

    return [this.buildReportArtifact(status, exitCode, {
      format: "nikto_json",
      path: outputPath,
      bytes: statSync(outputPath).size,
      sha256: createHash("sha256").update(content).digest("hex"),
    }, report)];
  }

  private buildReportArtifact(
    status: ToolRunCompleted["status"],
    exitCode: number | null,
    source: Record<string, unknown> | null,
    report: ReturnType<typeof parseNiktoJsonReport>,
  ): ToolRunArtifactInput {
    return {
      artifactType: "nikto_report",
      label: "Nikto Standard report",
      source: "nikto.json",
      payload: {
        source,
        runContext: { profile: "standard", status, exitCode },
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

  private getOutputPath(sessionId: string, toolRunId: string) {
    return join(
      getAppDataDirectory(),
      "artifacts",
      "sessions",
      sessionId,
      "tool-runs",
      toolRunId,
      "nikto.json",
    );
  }
}

export const niktoCommandService = new NiktoCommandService();
