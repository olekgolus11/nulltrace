import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, statSync } from "node:fs";
import { dirname, join } from "node:path";
import { ToolRunArtifactInput } from "../../../session/model/session.repository.types";
import { getAppDataDirectory } from "../../../session/services/session-database";
import { ToolPrepareCommand, ToolRunCompleted } from "../../shared/types/tool-screen.types";
import { getFfufFieldOrder } from "../config/ffuf.config";
import {
  FfufContentDiscoveryFieldId,
  FfufContentDiscoveryFormState,
  FfufContentDiscoveryToolData,
  FfufFieldId,
  FfufMode,
  FfufParameterDiscoveryFieldId,
  FfufParameterDiscoveryFormState,
  FfufParameterDiscoveryToolData,
  FfufParameterLocation,
  FfufToolData,
} from "../types/ffuf.types";
import { mapFfufParameterCandidates, parseFfufOutput } from "./ffuf-output.helpers";

const ffufOutputFlagPattern = new RegExp(
  String.raw`\s+(?:(?:-json)(?:=(?:true|false))?(?=\s|$)|(?:-o|-output|-of|-output-format)(?:(?:\s+('[^']*'|"(?:\\.|[^"])*"|\S+))|=('(?:[^']*)'|"(?:\\.|[^"])*"|\S+)))`,
  "g",
);
const ffufExecutionLimitPattern = /\s+-(?:rate|maxtime)(?:\s+('[^']*'|"(?:\\.|[^"])*"|\S+)|=('[^']*'|"(?:\\.|[^"])*"|\S+))/g;
const ffufTargetPattern = /(?:^|\s)-u(?:\s+|=)(?:'([^']*)'|"([^"]*)"|(\S+))/g;
const ffufShellControlPattern = /[;|`$()<>\n\r]/;
const ffufShellBackgroundPattern = /(?:^|\s)&{1,2}(?=\s|$)/;
const defaultFfufRate = 25;
const maximumFfufRate = 100;
const defaultFfufTimeLimit = 10;
const maximumFfufTimeLimit = 60;
const maximumParameterCandidateCount = 200;

export function createInitialFfufToolData(targetUrl: string): FfufContentDiscoveryToolData {
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
      rate: String(defaultFfufRate),
      timeLimit: String(defaultFfufTimeLimit),
    },
  };
}

export function createInitialFfufParameterDiscoveryToolData(
  endpoint: string,
): FfufParameterDiscoveryToolData {
  return {
    mode: "parameter_discovery",
    selectedField: 0,
    form: {
      endpoint,
      requestLocation: "query",
      wordlist: "",
      matchCodes: "",
      filterCodes: "",
      rate: String(defaultFfufRate),
      timeLimit: String(defaultFfufTimeLimit),
    },
  };
}

export function buildFfufCommand(toolData: FfufToolData): string {
  return toolData.mode === "parameter_discovery"
    ? buildFfufParameterDiscoveryCommand(toolData)
    : buildFfufContentDiscoveryCommand(toolData);
}

export function buildFfufContentDiscoveryCommand(toolData: FfufContentDiscoveryToolData): string {
  const { form } = toolData;
  const command = ["ffuf"];

  if (form.targetPattern.trim()) command.push("-u", form.targetPattern.trim());
  if (form.wordlist.trim()) command.push("-w", form.wordlist.trim());
  if (form.extensions.trim()) command.push("-e", form.extensions.trim());
  if (form.recursion) command.push("-recursion");
  if (form.recursion && form.recursionDepth.trim()) {
    command.push("-recursion-depth", form.recursionDepth.trim());
  }
  appendFfufMatcherAndLimitFlags(command, form);
  return command.join(" ");
}

export function buildFfufParameterDiscoveryCommand(
  toolData: FfufParameterDiscoveryToolData,
): string {
  const { form } = toolData;
  const command = ["ffuf"];
  const endpoint = form.endpoint.trim();

  if (endpoint) {
    if (form.requestLocation === "query") {
      const separator = endpoint.includes("?") ? "&" : "?";
      command.push("-u", shellQuoteFfufValue(`${endpoint}${separator}FUZZ=nulltrace`));
    } else {
      command.push("-u", endpoint);
      if (form.requestLocation === "body") {
        command.push("-X", "POST", "-d", shellQuoteFfufValue("FUZZ=nulltrace"));
      } else {
        command.push("-H", shellQuoteFfufValue("FUZZ: nulltrace"));
      }
    }
  }
  if (form.wordlist.trim()) command.push("-w", form.wordlist.trim());
  appendFfufMatcherAndLimitFlags(command, form);
  return command.join(" ");
}

export function setFfufContentDiscoveryField(
  toolData: FfufContentDiscoveryToolData,
  field: keyof FfufContentDiscoveryFormState,
  value: string | boolean,
): FfufContentDiscoveryToolData {
  return {
    ...toolData,
    form: {
      ...toolData.form,
      [field]: value,
    },
  };
}

export function setFfufParameterDiscoveryField(
  toolData: FfufParameterDiscoveryToolData,
  field: keyof FfufParameterDiscoveryFormState,
  value: string,
): FfufParameterDiscoveryToolData {
  return {
    ...toolData,
    form: {
      ...toolData.form,
      [field]: value,
    },
  };
}

export function cycleFfufMode(toolData: FfufToolData, direction: -1 | 1): FfufToolData {
  const nextMode: FfufMode =
    toolData.mode === "content_discovery" && direction === 1
      ? "parameter_discovery"
      : toolData.mode === "parameter_discovery" && direction === -1
        ? "content_discovery"
        : toolData.mode;
  if (nextMode === toolData.mode) return toolData;

  if (toolData.mode === "content_discovery") {
    const parameterToolData = createInitialFfufParameterDiscoveryToolData(
      getFfufEndpointFromPattern(toolData.form.targetPattern),
    );
    return {
      ...parameterToolData,
      form: {
        ...parameterToolData.form,
        wordlist: toolData.form.wordlist,
        matchCodes: toolData.form.matchCodes,
        filterCodes: toolData.form.filterCodes,
        rate: toolData.form.rate,
        timeLimit: toolData.form.timeLimit,
      },
    };
  }

  const contentToolData = createInitialFfufToolData(toolData.form.endpoint);
  return {
    ...contentToolData,
    form: {
      ...contentToolData.form,
      wordlist: toolData.form.wordlist,
      matchCodes: toolData.form.matchCodes,
      filterCodes: toolData.form.filterCodes,
      rate: toolData.form.rate,
      timeLimit: toolData.form.timeLimit,
    },
  };
}

export function moveFfufFieldSelection(toolData: FfufToolData, delta: -1 | 1): FfufToolData {
  const fieldOrder = getFfufFieldOrder(toolData.mode);
  return {
    ...toolData,
    selectedField: Math.max(0, Math.min(toolData.selectedField + delta, fieldOrder.length - 1)),
  };
}

export function isFfufBooleanField(field: FfufFieldId | undefined): field is "recursion" {
  return field === "recursion";
}

export function isFfufRequestLocationField(
  field: FfufFieldId | undefined,
): field is "requestLocation" {
  return field === "requestLocation";
}

export function cycleFfufRequestLocation(
  toolData: FfufParameterDiscoveryToolData,
  direction: -1 | 1,
): FfufParameterDiscoveryToolData {
  const locations: readonly FfufParameterLocation[] = ["query", "body", "header"];
  const currentIndex = locations.indexOf(toolData.form.requestLocation);
  const nextIndex = (currentIndex + direction + locations.length) % locations.length;
  return setFfufParameterDiscoveryField(
    toolData,
    "requestLocation",
    locations[nextIndex] ?? "query",
  );
}

export function toggleFfufBooleanField(
  toolData: FfufContentDiscoveryToolData,
  field: FfufContentDiscoveryFieldId,
): FfufContentDiscoveryToolData {
  if (!isFfufBooleanField(field)) return toolData;
  return setFfufContentDiscoveryField(toolData, field, !toolData.form[field]);
}

export function prepareFfufCommandForRun(options: ToolPrepareCommand): string {
  const { command, sessionId, targetUrl, toolData, toolRunId } = options;
  if (targetUrl) validateFfufCommandExactOrigin(command, targetUrl);
  if (!sessionId || !toolRunId) return command;

  const jsonOutputPath = getFfufJsonOutputPath(sessionId, toolRunId);
  mkdirSync(dirname(jsonOutputPath), { recursive: true });
  const strippedCommand = command
    .replace(ffufOutputFlagPattern, " ")
    .replace(ffufExecutionLimitPattern, " ")
    .trim();
  const limits = getFfufExecutionLimits(toolData);
  return `${strippedCommand} -rate ${limits.rate} -maxtime ${limits.timeLimit} -of json -o ${shellQuoteFfufValue(jsonOutputPath)}`;
}

export async function collectFfufArtifacts(
  options: ToolRunCompleted,
): Promise<ToolRunArtifactInput[]> {
  const { sessionId, toolRunId, command, status, exitCode, toolData } = options;
  if (!sessionId || !toolRunId || status === "cancelled") return [];

  const jsonOutputPath = getFfufJsonOutputPath(sessionId, toolRunId);
  if (!existsSync(jsonOutputPath)) return [];

  const json = readFileSync(jsonOutputPath, "utf8");
  if (!json.trim()) return [];

  const parsed = parseFfufOutput(json);
  const parsedToolData = readFfufToolData(toolData);
  if (parsedToolData.mode === "parameter_discovery") {
    const candidates = mapFfufParameterCandidates(
      parsed.results,
      parsedToolData.form,
      toolRunId,
      maximumParameterCandidateCount,
    );
    return [
      {
        artifactType: "ffuf_parameter_discovery",
        label: "FFUF Parameter Discovery",
        source: "ffuf.json",
        payload: {
          source: getFfufArtifactSource(jsonOutputPath, json),
          scanner: {
            name: "ffuf",
            mode: "parameter_discovery",
            status,
            exitCode,
          },
          runContext: {
            command: command ?? null,
            endpoint: parsedToolData.form.endpoint,
            requestLocation: parsedToolData.form.requestLocation,
            wordlist: parsedToolData.form.wordlist,
          },
          parseErrorCount: parsed.parseErrorCount,
          candidates,
          isTruncated: parsed.results.length > candidates.length,
        },
      },
    ];
  }

  return [
    {
      artifactType: "ffuf_content_discovery",
      label: "FFUF Content Discovery",
      source: "ffuf.json",
      payload: {
        source: getFfufArtifactSource(jsonOutputPath, json),
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

function appendFfufMatcherAndLimitFlags(
  command: string[],
  form: Pick<
    FfufContentDiscoveryFormState | FfufParameterDiscoveryFormState,
    "matchCodes" | "filterCodes" | "rate" | "timeLimit"
  >,
) {
  if (form.matchCodes.trim()) command.push("-mc", form.matchCodes.trim());
  if (form.filterCodes.trim()) command.push("-fc", form.filterCodes.trim());
  if (form.rate.trim()) command.push("-rate", form.rate.trim());
  if (form.timeLimit.trim()) command.push("-maxtime", form.timeLimit.trim());
}

function getFfufEndpointFromPattern(targetPattern: string) {
  return targetPattern.replace(/([?&])?FUZZ(?:=[^&#\s]*)?/, "").replace(/[?&]$/, "");
}

function getFfufExecutionLimits(toolData: unknown) {
  const form = readFfufToolData(toolData).form;
  return {
    rate: getBoundedPositiveInteger(form.rate, defaultFfufRate, maximumFfufRate),
    timeLimit: getBoundedPositiveInteger(
      form.timeLimit,
      defaultFfufTimeLimit,
      maximumFfufTimeLimit,
    ),
  };
}

function getBoundedPositiveInteger(value: string, fallback: number, maximum: number) {
  const parsed = Number.parseInt(value, 10);
  if (!Number.isFinite(parsed) || parsed <= 0) return fallback;
  return Math.min(parsed, maximum);
}

function getFfufArtifactSource(jsonOutputPath: string, json: string) {
  return {
    format: "ffuf_json",
    path: jsonOutputPath,
    bytes: statSync(jsonOutputPath).size,
    sha256: createHash("sha256").update(json).digest("hex"),
  };
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

function readFfufToolData(toolData: unknown): FfufToolData {
  if (
    toolData &&
    typeof toolData === "object" &&
    (toolData as { mode?: unknown }).mode === "parameter_discovery" &&
    (toolData as { form?: unknown }).form &&
    typeof (toolData as { form?: unknown }).form === "object"
  ) {
    return toolData as FfufParameterDiscoveryToolData;
  }
  if (toolData && typeof toolData === "object" && (toolData as { form?: unknown }).form) {
    return toolData as FfufContentDiscoveryToolData;
  }
  return createInitialFfufToolData("");
}

function validateFfufCommandExactOrigin(command: string, targetUrl: string) {
  if (ffufShellControlPattern.test(command) || ffufShellBackgroundPattern.test(command)) {
    throw new Error("FFUF must run as one simple FFUF command without shell control syntax.");
  }

  const targets = [...command.matchAll(ffufTargetPattern)]
    .map((matchedTarget) => matchedTarget[1] ?? matchedTarget[2] ?? matchedTarget[3])
    .filter((target): target is string => Boolean(target));
  if (targets.length !== 1) {
    throw new Error("FFUF command must include exactly one target URL with -u.");
  }

  try {
    if (new URL(targets[0]).origin !== new URL(targetUrl).origin) {
      throw new Error("FFUF command target must use the session exact target origin.");
    }
  } catch (error) {
    if (error instanceof Error && error.message.includes("exact target origin")) {
      throw error;
    }
    throw new Error("FFUF command must use a valid URL on the session exact target origin.");
  }
}

function shellQuoteFfufValue(value: string) {
  return `'${value.split("'").join("'\\''")}'`;
}
