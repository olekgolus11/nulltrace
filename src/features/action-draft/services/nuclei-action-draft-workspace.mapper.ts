import { AuthenticatedRequestContextMetadata } from "../../authentication/model/authenticated-request-context.types";
import { normalizeExactOrigin } from "../../authentication/services/authenticated-request-context.service";
import { nucleiSeverityOptions } from "../../tool/nuclei/config/nuclei.config";
import { NucleiToolData } from "../../tool/nuclei/types/nuclei.types";
import {
  getActionDraftBooleanField,
  getActionDraftStringField,
} from "./action-draft-payload.helpers";

export function mapNucleiActionDraftFormState(
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
  const form = { ...toolData.form };

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
