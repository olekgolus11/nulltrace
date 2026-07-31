import { NiktoToolData } from "../../tool/nikto/types/nikto.types";
import { AuthenticatedRequestContextMetadata } from "../../authentication/model/authenticated-request-context.types";
import { isAcceptedAuthenticatedContextForTarget } from "../../authentication/services/authenticated-request-context-scope.helpers";
import {
  getActionDraftBooleanField,
  getActionDraftStringField,
} from "./action-draft-payload.helpers";
import { getNiktoDraftTuning } from "./nikto-action-draft-validation.helpers";

export function mapNiktoActionDraftFormState(
  toolData: NiktoToolData,
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
  ([
    "target",
    "rootPath",
    "vhost",
    "timeoutSeconds",
    "requestTimeoutSeconds",
    "pauseSeconds",
  ] as const).forEach((field) => {
    const value = getActionDraftStringField(formState, field);
    if (value !== undefined) {
      form[field] = value;
      didApply = true;
    }
  });
  const profile = getActionDraftStringField(formState, "profile");
  if (profile === "standard" || profile === "custom") {
    form.profile = profile;
    didApply = true;
  }
  const tuning = getNiktoDraftTuning(formState.tuning);
  if (tuning) {
    form.tuning = tuning;
    didApply = true;
  }
  const useAuthenticatedContext =
    getActionDraftBooleanField(formState, "useAuthenticatedContext") ?? false;
  form.useAuthenticatedContext = useAuthenticatedContext;
  if (getActionDraftBooleanField(formState, "useAuthenticatedContext") !== undefined) {
    didApply = true;
  }
  const authenticatedOrigin = authenticatedContext?.authCheck.isProceedAllowed
    ? authenticatedContext.origin
    : null;
  const isAuthenticationAvailable = isAcceptedAuthenticatedContextForTarget(
    authenticatedContext,
    form.target,
  );

  return {
    toolData: {
      ...toolData,
      selectedField: 0,
      form,
      authentication: {
        strategy:
          useAuthenticatedContext && isAuthenticationAvailable ? "session" : "none",
        isAvailable: isAuthenticationAvailable,
        origin: authenticatedOrigin,
      },
    },
    didApply,
  };
}
