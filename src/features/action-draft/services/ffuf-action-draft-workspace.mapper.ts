import {
  createInitialFfufParameterDiscoveryToolData,
  createInitialFfufToolData,
} from "../../tool/ffuf/services/ffuf-command.helpers";
import {
  FfufParameterLocation,
  FfufToolData,
} from "../../tool/ffuf/types/ffuf.types";
import {
  getActionDraftBooleanField,
  getActionDraftStringField,
} from "./action-draft-payload.helpers";

export function mapFfufActionDraftFormState(
  toolData: FfufToolData,
  formState: Record<string, unknown> | null,
) {
  if (!formState) {
    return {
      toolData,
      didApply: false,
    };
  }

  return getActionDraftStringField(formState, "mode") === "parameter_discovery"
    ? mapParameterDiscoveryFormState(toolData, formState)
    : mapContentDiscoveryFormState(toolData, formState);
}

function mapContentDiscoveryFormState(
  toolData: FfufToolData,
  formState: Record<string, unknown>,
) {
  const contentToolData =
    toolData.mode === "content_discovery"
      ? toolData
      : createInitialFfufToolData(toolData.form.endpoint);
  let didApply = false;
  const form = { ...contentToolData.form };
  (
    [
      "targetPattern",
      "wordlist",
      "extensions",
      "recursionDepth",
      "matchCodes",
      "filterCodes",
      "rate",
      "timeLimit",
    ] as const
  ).forEach((field) => {
    const value = getActionDraftStringField(formState, field);
    if (value !== undefined) {
      form[field] = value;
      didApply = true;
    }
  });

  const recursion = getActionDraftBooleanField(formState, "recursion");
  if (recursion !== undefined) {
    form.recursion = recursion;
    didApply = true;
  }

  return {
    toolData: { ...contentToolData, selectedField: 0, form },
    didApply,
  };
}

function mapParameterDiscoveryFormState(
  toolData: FfufToolData,
  formState: Record<string, unknown>,
) {
  const endpoint =
    getActionDraftStringField(formState, "endpoint") ??
    (toolData.mode === "parameter_discovery" ? toolData.form.endpoint : toolData.form.targetPattern.replace(/\/FUZZ$/, ""));
  const parameterToolData = createInitialFfufParameterDiscoveryToolData(endpoint);
  const form = { ...parameterToolData.form };
  let didApply = false;

  (["endpoint", "wordlist", "matchCodes", "filterCodes", "rate", "timeLimit"] as const).forEach(
    (field) => {
      const value = getActionDraftStringField(formState, field);
      if (value !== undefined) {
        form[field] = value;
        didApply = true;
      }
    },
  );

  const requestLocation = getActionDraftStringField(formState, "requestLocation");
  if (isFfufParameterLocation(requestLocation)) {
    form.requestLocation = requestLocation;
    didApply = true;
  }

  return {
    toolData: { ...parameterToolData, selectedField: 0, form },
    didApply,
  };
}

function isFfufParameterLocation(value: string | undefined): value is FfufParameterLocation {
  return value === "query" || value === "body" || value === "header";
}
