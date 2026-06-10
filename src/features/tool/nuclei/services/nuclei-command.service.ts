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
  ToolRunCompleted,
} from "../../shared/types/tool-screen.types";
import {
  NucleiFieldId,
  NucleiFormState,
  NucleiSeverityPreset,
  NucleiToolData,
} from "../types/nuclei.types";

interface NucleiRawFinding {
  [key: string]: unknown;
}

export interface NucleiArtifactFinding {
  templateId: string | null;
  name: string | null;
  severity: string | null;
  matchedAt: string | null;
  type: string | null;
  tags: string[];
  description: string | null;
  references: string[];
  raw: NucleiRawFinding;
}

export interface ParsedNucleiJsonl {
  findings: NucleiArtifactFinding[];
  parseErrorCount: number;
}

const shellTokenPattern = String.raw`(?:'[^']*'|"(?:\\.|[^"])*"|\S+)`;
const nucleiOutputFlagPattern = new RegExp(
  String.raw`\s+(?:(?:-jsonl|-json|-j|-sresp|-store-resp)(?=\s|$)|(?:-o|-output|-jle|-jsonl-export|-je|-json-export|-me|-markdown-export|-se|-sarif-export|-rdb|-report-db|-srd|-store-resp-dir)(?:\s+${shellTokenPattern}))`,
  "g",
);

function getString(value: unknown): string | null {
  return typeof value === "string" && value.trim() ? value : null;
}

function getObject(value: unknown): NucleiRawFinding | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return null;
  }

  return value as NucleiRawFinding;
}

function getStringArray(value: unknown): string[] {
  if (Array.isArray(value)) {
    return value.filter((item): item is string => typeof item === "string");
  }

  if (typeof value === "string" && value.trim()) {
    return value
      .split(",")
      .map((item) => item.trim())
      .filter(Boolean);
  }

  return [];
}

function getFirstString(...values: unknown[]): string | null {
  for (const value of values) {
    const stringValue = getString(value);
    if (stringValue) {
      return stringValue;
    }
  }

  return null;
}

export function parseNucleiJsonl(content: string): ParsedNucleiJsonl {
  return content.split(/\r?\n/).reduce<ParsedNucleiJsonl>(
    (result, line) => {
      const trimmedLine = line.trim();
      if (!trimmedLine) {
        return result;
      }

      try {
        const raw = JSON.parse(trimmedLine) as unknown;
        const finding = getObject(raw);
        if (!finding) {
          return {
            ...result,
            parseErrorCount: result.parseErrorCount + 1,
          };
        }

        const info = getObject(finding.info);
        result.findings.push({
          templateId: getString(finding["template-id"]),
          name: getFirstString(info?.name, finding["template-id"]),
          severity: getString(info?.severity),
          matchedAt: getFirstString(finding["matched-at"], finding.host),
          type: getString(finding.type),
          tags: getStringArray(info?.tags),
          description: getString(info?.description),
          references: getStringArray(info?.reference),
          raw: finding,
        });
        return result;
      } catch {
        return {
          ...result,
          parseErrorCount: result.parseErrorCount + 1,
        };
      }
    },
    {
      findings: [],
      parseErrorCount: 0,
    },
  );
}

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

  private shellQuotePath(path: string): string {
    return `'${path.split("'").join("'\\''")}'`;
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
      },
      future: {
        auth: {
          strategy: "none",
        },
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

  setField(
    toolData: NucleiToolData,
    field: keyof NucleiFormState,
    value: string | NucleiSeverityPreset,
  ): NucleiToolData {
    return {
      ...toolData,
      form: {
        ...toolData.form,
        [field]: value,
      },
    };
  }

  moveSelection(
    toolData: NucleiToolData,
    delta: -1 | 1,
    max: number,
  ): NucleiToolData {
    return {
      ...toolData,
      selectedField: Math.max(0, Math.min(toolData.selectedField + delta, max)),
    };
  }

  cycleSeverity(toolData: NucleiToolData, delta: -1 | 1): NucleiToolData {
    const currentIndex = nucleiSeverityOptions.indexOf(
      toolData.form.severityPreset,
    );
    const nextIndex =
      (currentIndex + delta + nucleiSeverityOptions.length) %
      nucleiSeverityOptions.length;

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

  getFieldCount() {
    return nucleiFieldOrder.length;
  }

  prepareCommandForRun(options: ToolPrepareCommand): string {
    const { command, sessionId, toolRunId } = options;

    if (!sessionId || !toolRunId) {
      return command;
    }

    const jsonlOutputPath = this.getJsonlOutputPath(sessionId, toolRunId);
    const outputDirectory = dirname(jsonlOutputPath);
    mkdirSync(outputDirectory, { recursive: true });

    const strippedCommand = command.replace(nucleiOutputFlagPattern, " ");
    const jsonlOutputFlags = ` -jsonl-export ${this.shellQuotePath(jsonlOutputPath)}`;
    return strippedCommand + jsonlOutputFlags;
  }

  async collectArtifacts(
    options: ToolRunCompleted,
  ): Promise<ToolRunArtifactInput[]> {
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
