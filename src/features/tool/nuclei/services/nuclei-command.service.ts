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
import { redactNucleiCommandForPersistence } from "./nuclei-command-redaction";
import { shellQuote, shellTokenPattern, tokenizeShellCommand } from "./nuclei-shell";

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

const nucleiOutputFlagPattern = new RegExp(
  String.raw`\s+(?:(?:-jsonl|-json|-j|-sresp|-store-resp)(?=\s|$)|(?:-o|-output|-jle|-jsonl-export|-je|-json-export|-me|-markdown-export|-se|-sarif-export|-rdb|-report-db|-srd|-store-resp-dir)(?:\s+${shellTokenPattern}))`,
  "g",
);
const nucleiNoColorFlagPattern = /(?:^|\s)-(?:nc|no-color)(?=\s|$)/;
const authenticatedIncompatibleFlags = new Set([
  "debug",
  "dreq",
  "debug-req",
  "dresp",
  "debug-resp",
  "sresp",
  "store-resp",
  "srd",
  "store-resp-dir",
  "irr",
  "include-rr",
  "trace-log",
  "tlog",
  "H",
  "header",
  "V",
  "var",
  "sf",
  "secret-file",
  "fr",
  "follow-redirects",
  "fhr",
  "follow-host-redirects",
  "l",
  "list",
  "targets-inline",
  "resume",
  "t",
  "templates",
  "it",
  "include-templates",
  "turl",
  "template-url",
  "w",
  "workflows",
  "wurl",
  "workflow-url",
  "ai",
  "prompt",
  "code",
  "esc",
  "enable-self-contained",
  "file",
]);

function parseCommandFlag(token: string) {
  if (!token.startsWith("-") || token === "-") {
    return null;
  }
  const separatorIndex = token.indexOf("=");
  const rawName = separatorIndex === -1 ? token : token.slice(0, separatorIndex);
  return {
    name: rawName.replace(/^-+/, ""),
    inlineValue: separatorIndex === -1 ? null : token.slice(separatorIndex + 1),
  };
}

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

  private validateAuthenticatedCommand(command: string) {
    const tokens = tokenizeShellCommand(command);
    const targets: string[] = [];

    if (tokens[0] !== "nuclei") {
      throw new Error("Authenticated Nuclei runs require the nuclei executable directly.");
    }

    tokens.forEach((token, index) => {
      const flag = parseCommandFlag(token);
      if (!flag) {
        return;
      }
      if (authenticatedIncompatibleFlags.has(flag.name)) {
        throw new Error(
          "Authenticated Nuclei runs cannot use options that expose raw requests or responses, enable redirects, accept multiple targets, or supply authorization values directly.",
        );
      }
      if (flag.name === "omit-raw" || flag.name === "or") {
        const value = flag.inlineValue ?? tokens[index + 1] ?? "";
        if (value.toLowerCase() === "false") {
          throw new Error(
            "Authenticated Nuclei runs cannot disable raw request or response omission.",
          );
        }
      }
      if (flag.name === "u" || flag.name === "target") {
        const target = flag.inlineValue ?? tokens[index + 1] ?? "";
        if (target) {
          targets.push(target);
        }
      }
    });

    if (targets.length !== 1 || targets[0]?.includes(",") || targets[0]?.includes("\n")) {
      throw new Error(
        "Authenticated Nuclei runs require exactly one explicit HTTP or HTTPS target.",
      );
    }
    return targets[0]!;
  }

  async prepareCommandForRun(options: ToolPrepareCommand): Promise<string | ToolPreparedCommand> {
    const { command, sessionId, toolRunId } = options;

    if (!sessionId || !toolRunId) {
      return command;
    }

    const jsonlOutputPath = this.getJsonlOutputPath(sessionId, toolRunId);
    const outputDirectory = dirname(jsonlOutputPath);
    mkdirSync(outputDirectory, { recursive: true });

    const strippedCommand = command.replace(nucleiOutputFlagPattern, " ");
    const colorSafeCommand = nucleiNoColorFlagPattern.test(strippedCommand)
      ? strippedCommand
      : strippedCommand + " -nc";
    const jsonlOutputFlags = ` -jsonl-export ${shellQuote(jsonlOutputPath)}`;
    const controlledCommand = colorSafeCommand + jsonlOutputFlags;
    const toolData = options.toolData as NucleiToolData | null | undefined;
    if (!toolData?.form.useAuthenticatedContext) {
      return controlledCommand;
    }

    const authenticatedTarget = this.validateAuthenticatedCommand(command);
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
