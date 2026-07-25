import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, statSync } from "node:fs";
import { dirname, join } from "node:path";
import { ToolRunArtifactInput } from "../../../session/model/session.repository.types";
import { getAppDataDirectory } from "../../../session/services/session-database";
import { ToolPrepareCommand, ToolRunCompleted } from "../../shared/types/tool-screen.types";
import { ffufFieldOrder } from "../config/ffuf.config";
import {
  FfufContentDiscoveryFormState,
  FfufFieldId,
  FfufToolData,
} from "../types/ffuf.types";
import { parseFfufOutput } from "./ffuf-output.helpers";

const ffufOutputFlagPattern = new RegExp(
  String.raw`\s+(?:(?:-json)(?:=(?:true|false))?(?=\s|$)|(?:-o|-output|-of|-output-format)(?:(?:\s+(?:'[^']*'|"(?:\\.|[^"])*"|\S+))|=(?:'[^']*'|"(?:\\.|[^"])*"|\S+)))`,
  "g",
);

export function createInitialFfufToolData(targetUrl: string): FfufToolData {
  return {
    mode: "content_discovery",
    selectedField: 0,
    form: {
      targetPattern: `${targetUrl.replace(/\/$/, "")}/FUZZ`,
      wordlist: "",
      extensions: "",
      recursion: false,
      recursionDepth: "",
      matchCodes: "",
      filterCodes: "",
      rate: "",
      timeLimit: "",
    },
  };
}

export function buildFfufContentDiscoveryCommand(toolData: FfufToolData) {
  const form = toolData.form;
  const command = ["ffuf"];

  if (form.targetPattern.trim()) command.push("-u", form.targetPattern.trim());
  if (form.wordlist.trim()) command.push("-w", form.wordlist.trim());
  if (form.extensions.trim()) command.push("-e", form.extensions.trim());
  if (form.recursion) command.push("-recursion");
  if (form.recursion && form.recursionDepth.trim()) {
    command.push("-recursion-depth", form.recursionDepth.trim());
  }
  if (form.matchCodes.trim()) command.push("-mc", form.matchCodes.trim());
  if (form.filterCodes.trim()) command.push("-fc", form.filterCodes.trim());
  if (form.rate.trim()) command.push("-rate", form.rate.trim());
  if (form.timeLimit.trim()) command.push("-maxtime", form.timeLimit.trim());

  return command.join(" ");
}

export function setFfufContentDiscoveryField(
  toolData: FfufToolData,
  field: keyof FfufContentDiscoveryFormState,
  value: string | boolean,
): FfufToolData {
  return {
    ...toolData,
    form: {
      ...toolData.form,
      [field]: value,
    },
  };
}

export function moveFfufFieldSelection(toolData: FfufToolData, delta: -1 | 1) {
  return {
    ...toolData,
    selectedField: Math.max(0, Math.min(toolData.selectedField + delta, ffufFieldOrder.length - 1)),
  };
}

export function isFfufBooleanField(field: FfufFieldId | undefined) {
  return field === "recursion";
}

export function toggleFfufBooleanField(toolData: FfufToolData, field: FfufFieldId) {
  if (!isFfufBooleanField(field)) return toolData;

  return setFfufContentDiscoveryField(toolData, field, !toolData.form[field]);
}

export function prepareFfufCommandForRun(options: ToolPrepareCommand): string {
  const { command, sessionId, toolRunId } = options;
  if (!sessionId || !toolRunId) return command;

  const jsonOutputPath = getFfufJsonOutputPath(sessionId, toolRunId);
  mkdirSync(dirname(jsonOutputPath), { recursive: true });
  const strippedCommand = command.replace(ffufOutputFlagPattern, " ").trim();
  return `${strippedCommand} -of json -o ${shellQuoteFfufPath(jsonOutputPath)}`;
}

export async function collectFfufArtifacts(
  options: ToolRunCompleted,
): Promise<ToolRunArtifactInput[]> {
  const { sessionId, toolRunId, command, status, exitCode } = options;
  if (!sessionId || !toolRunId || status === "cancelled") return [];

  const jsonOutputPath = getFfufJsonOutputPath(sessionId, toolRunId);
  if (!existsSync(jsonOutputPath)) return [];

  const json = readFileSync(jsonOutputPath, "utf8");
  if (!json.trim()) return [];

  const parsed = parseFfufOutput(json);
  return [
    {
      artifactType: "ffuf_content_discovery",
      label: "FFUF Content Discovery",
      source: "ffuf.json",
      payload: {
        source: {
          format: "ffuf_json",
          path: jsonOutputPath,
          bytes: statSync(jsonOutputPath).size,
          sha256: createHash("sha256").update(json).digest("hex"),
        },
        scanner: {
          name: "ffuf",
          mode: "content_discovery",
          status,
          exitCode,
        },
        runContext: {
          command: command ?? null,
        },
        parseErrorCount: parsed.parseErrorCount,
        results: parsed.results,
      },
    },
  ];
}

function getFfufJsonOutputPath(sessionId: string, toolRunId: string) {
  return join(
    getAppDataDirectory(),
    "artifacts",
    "sessions",
    sessionId,
    "tool-runs",
    toolRunId,
    "ffuf.json",
  );
}

function shellQuoteFfufPath(path: string) {
  return `'${path.split("'").join("'\\''")}'`;
}
