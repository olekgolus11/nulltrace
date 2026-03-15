import { NmapFieldId, NmapFormState, NmapTiming, ToolDefinition } from "../model/tool.types";

export const nmapTimingOptions: NmapTiming[] = ["T2", "T3", "T4", "T5"];

export const nmapFieldOrder: NmapFieldId[] = [
  "target",
  "ports",
  "timing",
  "serviceDetection",
  "osDetection",
  "defaultScripts",
  "aggressive",
  "extraArgs",
];

function extractHostname(targetUrl: string) {
  try {
    return new URL(targetUrl).hostname;
  } catch {
    return targetUrl
      .replace(/^https?:\/\//, "")
      .replace(/\/.*$/, "")
      .trim();
  }
}

export function createInitialNmapForm(targetUrl: string): NmapFormState {
  return {
    target: extractHostname(targetUrl),
    ports: "",
    timing: "T3",
    serviceDetection: true,
    osDetection: false,
    defaultScripts: false,
    aggressive: false,
    extraArgs: "",
  };
}

export function buildNmapCommand(form: NmapFormState) {
  const cmd: string[] = ["nmap"];

  if (form.aggressive) {
    cmd.push("-A");
  } else {
    if (form.serviceDetection) {
      cmd.push("-sV");
    }
    if (form.osDetection) {
      cmd.push("-O");
    }
    if (form.defaultScripts) {
      cmd.push("-sC");
    }
  }

  cmd.push(`-${form.timing}`);

  if (form.ports.trim()) {
    cmd.push("-p", form.ports.trim());
  }

  if (form.extraArgs.trim()) {
    cmd.push(form.extraArgs.trim());
  }

  if (form.target.trim()) {
    cmd.push(form.target.trim());
  }

  return cmd.join(" ").trim();
}

export const toolDefinitions: Record<string, ToolDefinition> = {
  nmap: {
    id: "nmap",
    name: "Nmap",
    description: "Network mapper with guided scan profiles and manual control.",
    createInitialForm: createInitialNmapForm,
    buildCommand: buildNmapCommand,
  },
};
