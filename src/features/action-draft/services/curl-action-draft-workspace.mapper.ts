import { AuthenticatedRequestContextMetadata } from "../../authentication/model/authenticated-request-context.types";
import { isAcceptedAuthenticatedContextForTarget } from "../../authentication/services/authenticated-request-context-scope.helpers";
import {
  normalizeCurlMethod,
  validateCurlRequestBodySize,
} from "../../tool/curl/services/curl-command.helpers";
import { CurlToolData } from "../../tool/curl/types/curl.types";
import {
  getActionDraftBooleanField,
  getActionDraftStringField,
} from "./action-draft-payload.helpers";

export function mapCurlActionDraftFormState(
  toolData: CurlToolData,
  formState: Record<string, unknown> | null,
  authenticatedContext: AuthenticatedRequestContextMetadata | null,
) {
  if (!formState) {
    return {
      toolData: setCurlActionDraftAuthentication(toolData, false, authenticatedContext),
      didApply: false,
    };
  }

  const form = { ...toolData.form };
  let didApply = false;

  (["targetUrl", "headers", "body"] as const).forEach((field) => {
    const value = getActionDraftStringField(formState, field);
    if (value !== undefined) {
      form[field] = value;
      didApply = true;
    }
  });

  const method = getActionDraftStringField(formState, "method");
  if (method !== undefined) {
    form.method = normalizeCurlMethod(method);
    didApply = true;
  }

  const bodyMode = getActionDraftStringField(formState, "bodyMode");
  if (bodyMode !== undefined) {
    if (bodyMode !== "text" && bodyMode !== "json") {
      throw new Error("cURL bodyMode must be text or json.");
    }
    form.bodyMode = bodyMode;
    didApply = true;
  }

  if (form.bodyMode === "json" && form.body.trim()) {
    try {
      JSON.parse(form.body);
    } catch {
      throw new Error("cURL JSON body must contain valid JSON.");
    }
  }
  validateCurlRequestBodySize(form.body);

  const requestedAuthentication =
    getActionDraftBooleanField(formState, "useAuthenticatedContext") ?? false;
  const mappedToolData = setCurlActionDraftAuthentication(
    { ...toolData, selectedField: 0, form },
    requestedAuthentication,
    authenticatedContext,
  );

  return {
    toolData: mappedToolData,
    didApply:
      didApply ||
      getActionDraftBooleanField(formState, "useAuthenticatedContext") !== undefined,
  };
}

function setCurlActionDraftAuthentication(
  toolData: CurlToolData,
  useAuthenticatedContext: boolean,
  authenticatedContext: AuthenticatedRequestContextMetadata | null,
): CurlToolData {
  const isAvailable = isAcceptedAuthenticatedContextForTarget(
    authenticatedContext,
    toolData.form.targetUrl,
  );
  const isEnabled = useAuthenticatedContext && isAvailable;
  return {
    ...toolData,
    form: {
      ...toolData.form,
      useAuthenticatedContext: isEnabled,
    },
    authentication: {
      strategy: isEnabled ? "session" : "none",
      isAvailable,
      origin: isAvailable ? authenticatedContext?.origin ?? null : null,
    },
  };
}
