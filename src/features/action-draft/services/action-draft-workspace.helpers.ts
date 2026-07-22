import { AuthenticatedRequestContextMetadata } from "../../authentication/model/authenticated-request-context.types";
import { normalizeExactOrigin } from "../../authentication/services/authenticated-request-context.service";
import { nmapTimingOptions } from "../../tool/nmap/config/nmap.config";
import { NmapToolData } from "../../tool/nmap/types/nmap.types";
import { nucleiSeverityOptions } from "../../tool/nuclei/config/nuclei.config";
import { NucleiToolData } from "../../tool/nuclei/types/nuclei.types";
import { ActionDraftRecord } from "../model/action-draft.types";

interface ActionDraftPayload {
  command?: unknown;
  formState?: unknown;
}

export function getActionDraftPayload(draft: ActionDraftRecord): ActionDraftPayload {
  return isRecord(draft.payload) ? draft.payload : {};
}

export function getActionDraftCommand(payload: ActionDraftPayload) {
  return typeof payload.command === "string" && payload.command.trim()
    ? payload.command.trim()
    : null;
}

export function getActionDraftFormState(payload: ActionDraftPayload) {
  return isRecord(payload.formState) ? payload.formState : null;
}

export function getActionDraftStringField(formState: Record<string, unknown>, field: string) {
  const value = formState[field];
  return typeof value === "string" ? value : undefined;
}

export function getActionDraftBooleanField(formState: Record<string, unknown>, field: string) {
  const value = formState[field];
  return typeof value === "boolean" ? value : undefined;
}

export function applyActionDraftFormState(
  currentToolName: string,
  currentToolData: unknown,
  formState: Record<string, unknown> | null,
  authenticatedContext: AuthenticatedRequestContextMetadata | null,
) {
  if (currentToolName === "nmap") {
    return applyNmapFormState(currentToolData as NmapToolData, formState);
  }

  if (currentToolName === "nuclei") {
    return applyNucleiFormState(currentToolData as NucleiToolData, formState, authenticatedContext);
  }

  return {
    toolData: currentToolData,
    didApply: false,
  };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function applyNmapFormState(toolData: NmapToolData, formState: Record<string, unknown> | null) {
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
    const value = getActionDraftStringField(formState, field);
    if (value !== undefined) {
      form[field] = value;
      didApply = true;
    }
  });

  const timing = getActionDraftStringField(formState, "timing");
  if (timing && nmapTimingOptions.includes(timing as typeof form.timing)) {
    form.timing = timing as typeof form.timing;
    didApply = true;
  }

  (["serviceDetection", "osDetection", "defaultScripts", "aggressive"] as const).forEach(
    (field) => {
      const value = getActionDraftBooleanField(formState, field);
      if (value !== undefined) {
        form[field] = value;
        didApply = true;
      }
    },
  );

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
  authenticatedContext: AuthenticatedRequestContextMetadata | null,
) {
  if (!formState) {
    return {
      toolData: {
        ...toolData,
        form: {
          ...toolData.form,
          useAuthenticatedContext: false,
        },
        authentication: {
          ...toolData.authentication,
          strategy: "none" as const,
        },
      },
      didApply: false,
    };
  }

  let didApply = false;
  const form = {
    ...toolData.form,
  };

  (["target", "tags", "templatesPath", "extraArgs"] as const).forEach((field) => {
    const value = getActionDraftStringField(formState, field);
    if (value !== undefined) {
      form[field] = value;
      didApply = true;
    }
  });

  const severityPreset = getActionDraftStringField(formState, "severityPreset");
  if (
    severityPreset &&
    nucleiSeverityOptions.includes(severityPreset as typeof form.severityPreset)
  ) {
    form.severityPreset = severityPreset as typeof form.severityPreset;
    didApply = true;
  }

  const useAuthenticatedContext = getActionDraftBooleanField(formState, "useAuthenticatedContext");
  form.useAuthenticatedContext = useAuthenticatedContext ?? false;
  if (useAuthenticatedContext !== undefined) {
    didApply = true;
  }

  const authenticatedOrigin = authenticatedContext?.authCheck.isProceedAllowed
    ? authenticatedContext.origin
    : null;
  let isAuthenticationAvailable = false;
  try {
    isAuthenticationAvailable = Boolean(
      authenticatedOrigin && normalizeExactOrigin(form.target) === authenticatedOrigin,
    );
  } catch {
    isAuthenticationAvailable = false;
  }

  return {
    toolData: {
      ...toolData,
      selectedField: 0,
      form,
      authentication: {
        strategy: form.useAuthenticatedContext && isAuthenticationAvailable ? "session" : "none",
        isAvailable: isAuthenticationAvailable,
        origin: authenticatedOrigin,
      },
    },
    didApply,
  };
}
