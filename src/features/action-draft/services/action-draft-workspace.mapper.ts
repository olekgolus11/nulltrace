import { ActionDraftRecord } from "../model/action-draft.types";
import {
  nmapTimingOptions,
} from "../../tool/nmap/config/nmap.config";
import { NmapToolData } from "../../tool/nmap/types/nmap.types";
import {
  nucleiSeverityOptions,
} from "../../tool/nuclei/config/nuclei.config";
import { NucleiToolData } from "../../tool/nuclei/types/nuclei.types";
import { CommandSource } from "../../tool/shared/types/tool-screen.types";

export interface ActionDraftWorkspaceApplication {
  toolData: unknown;
  commandInput: string;
  generatedCommand: string;
  commandSource: CommandSource;
  message: string;
}

export type ActionDraftWorkspaceApplyResult =
  | {
      ok: true;
      application: ActionDraftWorkspaceApplication;
    }
  | {
      ok: false;
      reason: string;
    };

export interface ActionDraftWorkspaceMapInput {
  draft: ActionDraftRecord;
  currentToolName: string;
  currentToolData: unknown;
  buildGeneratedCommand: (toolData: unknown) => string;
}

interface ActionDraftPayload {
  command?: unknown;
  formState?: unknown;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function getPayload(draft: ActionDraftRecord): ActionDraftPayload {
  return isRecord(draft.payload) ? draft.payload : {};
}

function getCommand(payload: ActionDraftPayload) {
  return typeof payload.command === "string" && payload.command.trim()
    ? payload.command.trim()
    : null;
}

function getFormState(payload: ActionDraftPayload) {
  return isRecord(payload.formState) ? payload.formState : null;
}

function getStringField(formState: Record<string, unknown>, field: string) {
  const value = formState[field];
  return typeof value === "string" ? value : undefined;
}

function getBooleanField(formState: Record<string, unknown>, field: string) {
  const value = formState[field];
  return typeof value === "boolean" ? value : undefined;
}

function applyNmapFormState(
  toolData: NmapToolData,
  formState: Record<string, unknown> | null,
) {
  if (!formState) {
    return {
      toolData,
      didApply: false,
    };
  }

  let didApply = false;
  const form = {
    ...toolData.form,
  };

  (["target", "ports", "extraArgs"] as const).forEach((field) => {
    const value = getStringField(formState, field);
    if (value !== undefined) {
      form[field] = value;
      didApply = true;
    }
  });

  const timing = getStringField(formState, "timing");
  if (timing && nmapTimingOptions.includes(timing as typeof form.timing)) {
    form.timing = timing as typeof form.timing;
    didApply = true;
  }

  (
    [
      "serviceDetection",
      "osDetection",
      "defaultScripts",
      "aggressive",
    ] as const
  ).forEach((field) => {
    const value = getBooleanField(formState, field);
    if (value !== undefined) {
      form[field] = value;
      didApply = true;
    }
  });

  return {
    toolData: {
      ...toolData,
      selectedField: 0,
      form,
    },
    didApply,
  };
}

function applyNucleiFormState(
  toolData: NucleiToolData,
  formState: Record<string, unknown> | null,
) {
  if (!formState) {
    return {
      toolData,
      didApply: false,
    };
  }

  let didApply = false;
  const form = {
    ...toolData.form,
  };

  (["target", "tags", "templatesPath", "extraArgs"] as const).forEach(
    (field) => {
      const value = getStringField(formState, field);
      if (value !== undefined) {
        form[field] = value;
        didApply = true;
      }
    },
  );

  const severityPreset = getStringField(formState, "severityPreset");
  if (
    severityPreset &&
    nucleiSeverityOptions.includes(severityPreset as typeof form.severityPreset)
  ) {
    form.severityPreset = severityPreset as typeof form.severityPreset;
    didApply = true;
  }

  return {
    toolData: {
      ...toolData,
      selectedField: 0,
      form,
    },
    didApply,
  };
}

function applyFormState(
  currentToolName: string,
  currentToolData: unknown,
  formState: Record<string, unknown> | null,
) {
  if (currentToolName === "nmap") {
    return applyNmapFormState(currentToolData as NmapToolData, formState);
  }

  if (currentToolName === "nuclei") {
    return applyNucleiFormState(currentToolData as NucleiToolData, formState);
  }

  return {
    toolData: currentToolData,
    didApply: false,
  };
}

export function mapActionDraftToWorkspaceState({
  draft,
  currentToolName,
  currentToolData,
  buildGeneratedCommand,
}: ActionDraftWorkspaceMapInput): ActionDraftWorkspaceApplyResult {
  if (draft.targetTool !== currentToolName) {
    return {
      ok: false,
      reason: `This draft targets ${draft.targetTool}, not ${currentToolName}.`,
    };
  }

  if (draft.targetTool !== "nmap" && draft.targetTool !== "nuclei") {
    return {
      ok: false,
      reason: `Draft target ${draft.targetTool} is not an implemented scanner workspace.`,
    };
  }

  const payload = getPayload(draft);
  const command = getCommand(payload);
  const { toolData, didApply } = applyFormState(
    currentToolName,
    currentToolData,
    getFormState(payload),
  );

  if (!command && !didApply) {
    return {
      ok: false,
      reason:
        "This draft has no usable command or form state for the current workspace.",
    };
  }

  const generatedCommand = buildGeneratedCommand(toolData);
  const commandInput = command ?? generatedCommand;

  return {
    ok: true,
    application: {
      toolData,
      generatedCommand,
      commandInput,
      commandSource:
        command && command !== generatedCommand ? "manual" : "generated",
      message: `Applied action draft: ${draft.title}`,
    },
  };
}
