import { AuthenticatedRequestContextMetadata } from "../../authentication/model/authenticated-request-context.types";
import { isAcceptedAuthenticatedContextForTarget } from "../../authentication/services/authenticated-request-context-scope.helpers";
import {
  createInitialFfufParameterDiscoveryToolData,
  createInitialFfufToolData,
  createInitialFfufValueFuzzingToolData,
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
  authenticatedContext: AuthenticatedRequestContextMetadata | null,
) {
  if (!formState) {
    return {
      toolData: setActionDraftAuthentication(toolData, false, authenticatedContext),
      didApply: false,
    };
  }

  const mapped = getActionDraftStringField(formState, "mode") === "parameter_discovery"
    ? mapParameterDiscoveryFormState(toolData, formState)
    : getActionDraftStringField(formState, "mode") === "value_fuzzing"
      ? mapValueFuzzingFormState(toolData, formState)
    : mapContentDiscoveryFormState(toolData, formState);
  const requestedAuthentication =
    getActionDraftBooleanField(formState, "useAuthenticatedContext") ?? false;
  return {
    toolData: setActionDraftAuthentication(
      mapped.toolData,
      requestedAuthentication,
      authenticatedContext,
    ),
    didApply:
      mapped.didApply ||
      getActionDraftBooleanField(formState, "useAuthenticatedContext") !== undefined,
  };
}

function setActionDraftAuthentication(
  toolData: FfufToolData,
  useAuthenticatedContext: boolean,
  authenticatedContext: AuthenticatedRequestContextMetadata | null,
): FfufToolData {
  const target =
    toolData.mode === "content_discovery"
      ? toolData.form.targetPattern
      : toolData.form.endpoint;
  const isAvailable = isAcceptedAuthenticatedContextForTarget(
    authenticatedContext,
    target,
  );
  const isEnabled = useAuthenticatedContext && isAvailable;
  return {
    ...toolData,
    form: {
      ...toolData.form,
      isAuthenticatedContextEnabled: isEnabled,
    },
    authentication: {
      strategy: isEnabled ? "session" : "none",
      isAvailable,
      origin: isAvailable ? authenticatedContext?.origin ?? null : null,
    },
  } as FfufToolData;
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
    (toolData.mode === "content_discovery"
      ? toolData.form.targetPattern.replace(/\/FUZZ$/, "")
      : toolData.form.endpoint);
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

function mapValueFuzzingFormState(
  toolData: FfufToolData,
  formState: Record<string, unknown>,
) {
  const endpoint =
    getActionDraftStringField(formState, "endpoint") ??
    (toolData.mode === "content_discovery"
      ? toolData.form.targetPattern.replace(/\/FUZZ$/, "")
      : toolData.form.endpoint);
  const valueToolData = createInitialFfufValueFuzzingToolData(endpoint);
  const form = { ...valueToolData.form };
  let didApply = false;

  (
    [
      "endpoint",
      "parameterName",
      "wordlist",
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

  const requestLocation = getActionDraftStringField(formState, "requestLocation");
  if (isFfufParameterLocation(requestLocation)) {
    form.requestLocation = requestLocation;
    didApply = true;
  }

  return {
    toolData: { ...valueToolData, selectedField: 0, form },
    didApply,
  };
}
