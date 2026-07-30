import { mkdirSync } from "node:fs";
import { dirname } from "node:path";
import {
  ToolPrepareCommand,
  ToolPreparedCommand,
} from "../../shared/types/tool-screen.types";
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
  FfufValueFuzzingFormState,
  FfufValueFuzzingToolData,
} from "../types/ffuf.types";
import { ffufAuthenticatedRunService } from "./ffuf-authenticated-run.service";
import { validateFfufCommandSecretInputs } from "./ffuf-authenticated-request.helpers";
import { getFfufJsonOutputPath } from "./ffuf-artifact.helpers";

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

export function createInitialFfufToolData(targetUrl: string): FfufContentDiscoveryToolData {
  return {
    mode: "content_discovery",
    selectedField: 0,
    authentication: {
      strategy: "none",
      isAvailable: false,
      origin: null,
    },
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
      isAuthenticatedContextEnabled: false,
    },
  };
}

export function createInitialFfufParameterDiscoveryToolData(
  endpoint: string,
): FfufParameterDiscoveryToolData {
  return {
    mode: "parameter_discovery",
    selectedField: 0,
    authentication: {
      strategy: "none",
      isAvailable: false,
      origin: null,
    },
    form: {
      endpoint,
      requestLocation: "query",
      wordlist: "",
      matchCodes: "",
      filterCodes: "",
      rate: String(defaultFfufRate),
      timeLimit: String(defaultFfufTimeLimit),
      isAuthenticatedContextEnabled: false,
    },
  };
}

export function createInitialFfufValueFuzzingToolData(
  endpoint: string,
): FfufValueFuzzingToolData {
  return {
    mode: "value_fuzzing",
    selectedField: 0,
    authentication: {
      strategy: "none",
      isAvailable: false,
      origin: null,
    },
    form: {
      endpoint,
      parameterName: "",
      requestLocation: "query",
      wordlist: "",
      matchCodes: "",
      filterCodes: "",
      rate: String(defaultFfufRate),
      timeLimit: String(defaultFfufTimeLimit),
      isAuthenticatedContextEnabled: false,
    },
  };
}

export function buildFfufCommand(toolData: FfufToolData): string {
  if (toolData.mode === "parameter_discovery") return buildFfufParameterDiscoveryCommand(toolData);
  if (toolData.mode === "value_fuzzing") return buildFfufValueFuzzingCommand(toolData);
  return buildFfufContentDiscoveryCommand(toolData);
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
      command.push("-u", shellQuoteFfufValue(endpoint));
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

export function buildFfufValueFuzzingCommand(toolData: FfufValueFuzzingToolData): string {
  const { form } = toolData;
  const command = ["ffuf"];
  const endpoint = form.endpoint.trim();
  const parameterName = form.parameterName.trim();

  if (endpoint && parameterName) {
    if (form.requestLocation === "query") {
      try {
        const url = new URL(endpoint);
        url.searchParams.set(parameterName, "FUZZ");
        command.push("-u", shellQuoteFfufValue(url.toString()));
        command.push("-enc", "FUZZ:urlencode");
      } catch {
        // Keep malformed draft/form input editable. Run preparation performs strict validation.
      }
    } else {
      command.push("-u", shellQuoteFfufValue(endpoint));
      if (form.requestLocation === "body") {
        command.push("-X", "POST", "-d", shellQuoteFfufValue(`${parameterName}=FUZZ`));
        command.push("-enc", "FUZZ:urlencode");
      } else {
        command.push("-H", shellQuoteFfufValue(`${parameterName}: FUZZ`));
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

export function setFfufValueFuzzingField(
  toolData: FfufValueFuzzingToolData,
  field: keyof FfufValueFuzzingFormState,
  value: string,
): FfufValueFuzzingToolData {
  return {
    ...toolData,
    form: {
      ...toolData.form,
      [field]: value,
    },
  };
}

export function cycleFfufMode(toolData: FfufToolData, direction: -1 | 1): FfufToolData {
  const modes: readonly FfufMode[] = [
    "content_discovery",
    "parameter_discovery",
    "value_fuzzing",
  ];
  const currentIndex = modes.indexOf(toolData.mode);
  const nextMode = modes[(currentIndex + direction + modes.length) % modes.length] ?? toolData.mode;
  if (nextMode === toolData.mode) return toolData;

  const endpoint =
    toolData.mode === "content_discovery"
      ? getFfufEndpointFromPattern(toolData.form.targetPattern)
      : toolData.form.endpoint;
  const sharedForm = {
    wordlist: toolData.form.wordlist,
    matchCodes: toolData.form.matchCodes,
    filterCodes: toolData.form.filterCodes,
    rate: toolData.form.rate,
    timeLimit: toolData.form.timeLimit,
    isAuthenticatedContextEnabled: toolData.form.isAuthenticatedContextEnabled,
  };
  if (nextMode === "parameter_discovery") {
    const parameterToolData = createInitialFfufParameterDiscoveryToolData(
      endpoint,
    );
    return {
      ...parameterToolData,
      authentication: toolData.authentication,
      form: { ...parameterToolData.form, ...sharedForm },
    };
  }
  if (nextMode === "value_fuzzing") {
    const valueToolData = createInitialFfufValueFuzzingToolData(endpoint);
    return {
      ...valueToolData,
      authentication: toolData.authentication,
      form: {
        ...valueToolData.form,
        ...sharedForm,
        requestLocation:
          toolData.mode === "parameter_discovery"
            ? toolData.form.requestLocation
            : valueToolData.form.requestLocation,
      },
    };
  }
  const contentToolData = createInitialFfufToolData(endpoint);
  return {
    ...contentToolData,
    authentication: toolData.authentication,
    form: { ...contentToolData.form, ...sharedForm },
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

export function cycleFfufRequestLocation<T extends FfufParameterDiscoveryToolData | FfufValueFuzzingToolData>(
  toolData: T,
  direction: -1 | 1,
): T {
  const locations: readonly FfufParameterLocation[] = ["query", "body", "header"];
  const currentIndex = locations.indexOf(toolData.form.requestLocation);
  const nextIndex = (currentIndex + direction + locations.length) % locations.length;
  return {
    ...toolData,
    form: {
      ...toolData.form,
      requestLocation: locations[nextIndex] ?? "query",
    },
  };
}

export function toggleFfufBooleanField(
  toolData: FfufContentDiscoveryToolData,
  field: FfufContentDiscoveryFieldId,
): FfufContentDiscoveryToolData {
  if (!isFfufBooleanField(field)) return toolData;
  return setFfufContentDiscoveryField(toolData, field, !toolData.form[field]);
}

export function prepareFfufCommandForRun(
  options: ToolPrepareCommand,
): string | Promise<ToolPreparedCommand> {
  const { command, sessionId, targetUrl, toolData, toolRunId } = options;
  validateFfufCommandSecretInputs(command);
  if (targetUrl) validateFfufCommandExactOrigin(command, targetUrl);
  validateFfufCommandMode(command, toolData);
  const parsedToolData = readFfufToolData(toolData);
  if (!sessionId || !toolRunId) {
    if (parsedToolData.form.isAuthenticatedContextEnabled) {
      throw new Error(
        "Authenticated FFUF runs require an active persisted tool run.",
      );
    }
    return command;
  }

  const jsonOutputPath = getFfufJsonOutputPath(sessionId, toolRunId);
  mkdirSync(dirname(jsonOutputPath), { recursive: true });
  const strippedCommand = command
    .replace(ffufOutputFlagPattern, " ")
    .replace(ffufExecutionLimitPattern, " ")
    .trim();
  const limits = getFfufExecutionLimits(toolData);
  const controlledCommand = `${strippedCommand} -rate ${limits.rate} -maxtime ${limits.timeLimit} -of json -o ${shellQuoteFfufValue(jsonOutputPath)}`;
  if (!parsedToolData.form.isAuthenticatedContextEnabled) return controlledCommand;
  if (!targetUrl) {
    throw new Error("Authenticated FFUF runs require a session target.");
  }
  const commandTarget = extractFfufCommandTarget(command);
  return ffufAuthenticatedRunService.prepare({
    sessionId,
    targetUrl: commandTarget,
    command: controlledCommand,
    toolData: parsedToolData,
    artifactOutputPath: jsonOutputPath,
  });
}

function appendFfufMatcherAndLimitFlags(
  command: string[],
  form: Pick<
    FfufContentDiscoveryFormState | FfufParameterDiscoveryFormState | FfufValueFuzzingFormState,
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

function readFfufToolData(toolData: unknown): FfufToolData {
  if (
    toolData &&
    typeof toolData === "object" &&
    (toolData as { mode?: unknown }).mode === "value_fuzzing" &&
    (toolData as { form?: unknown }).form &&
    typeof (toolData as { form?: unknown }).form === "object"
  ) {
    return toolData as FfufValueFuzzingToolData;
  }
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
    const commandTarget = new URL(targets[0]);
    if (commandTarget.username || commandTarget.password) {
      throw new Error("FFUF command target must not contain credentials.");
    }
    if (commandTarget.origin !== new URL(targetUrl).origin) {
      throw new Error("FFUF command target must use the session exact target origin.");
    }
  } catch (error) {
    if (
      error instanceof Error &&
      (error.message.includes("exact target origin") ||
        error.message.includes("must not contain credentials"))
    ) {
      throw error;
    }
    throw new Error("FFUF command must use a valid URL on the session exact target origin.");
  }
}

function extractFfufCommandTarget(command: string) {
  const target = [...command.matchAll(ffufTargetPattern)]
    .map((match) => match[1] ?? match[2] ?? match[3])
    .find((value): value is string => Boolean(value));
  if (!target) {
    throw new Error("FFUF command must include exactly one target URL with -u.");
  }
  return target;
}

function validateFfufCommandMode(command: string, toolData: unknown) {
  const isParameterDiscoveryCommand =
    /(?:[?&]FUZZ=|-d\s+['"]?FUZZ=|-H\s+['"]?FUZZ\s*:)/.test(command);
  const parsedToolData = readFfufToolData(toolData);
  const mode = parsedToolData.mode;

  if (mode === "parameter_discovery" && !isParameterDiscoveryCommand) {
    throw new Error("FFUF command must keep the selected Parameter Discovery mode.");
  }
  if (mode === "content_discovery" && isParameterDiscoveryCommand) {
    throw new Error("FFUF command must keep the selected Content Discovery mode.");
  }
  if (
    mode === "value_fuzzing" &&
    !isMatchingFfufValueCommand(command, parsedToolData)
  ) {
    throw new Error("FFUF command must keep the selected Value Fuzzing mode.");
  }
}

function isMatchingFfufValueCommand(
  command: string,
  toolData: FfufValueFuzzingToolData,
) {
  const parameterName = toolData.form.parameterName.trim();
  if (!parameterName) return false;
  const escapedParameter = escapeFfufPattern(parameterName);

  if (toolData.form.requestLocation === "body") {
    return new RegExp(`-d\\s+['"]?${escapedParameter}=FUZZ(?:['"]|\\s|$)`).test(command);
  }
  if (toolData.form.requestLocation === "header") {
    return new RegExp(`-H\\s+['"]?${escapedParameter}\\s*:\\s*FUZZ(?:['"]|\\s|$)`).test(command);
  }

  const target = [...command.matchAll(ffufTargetPattern)]
    .map((match) => match[1] ?? match[2] ?? match[3])
    .find((value): value is string => Boolean(value));
  if (!target) return false;
  try {
    const commandUrl = new URL(target);
    const endpointUrl = new URL(toolData.form.endpoint);
    return (
      commandUrl.origin === endpointUrl.origin &&
      commandUrl.pathname === endpointUrl.pathname &&
      commandUrl.searchParams.get(parameterName) === "FUZZ"
    );
  } catch {
    return false;
  }
}

function escapeFfufPattern(value: string) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function shellQuoteFfufValue(value: string) {
  return `'${value.split("'").join("'\\''")}'`;
}
