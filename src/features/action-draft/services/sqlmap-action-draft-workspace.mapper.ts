import { AuthenticatedRequestContextMetadata } from "../../authentication/model/authenticated-request-context.types";
import { isAcceptedAuthenticatedContextForTarget } from "../../authentication/services/authenticated-request-context-scope.helpers";
import { SqlmapToolData } from "../../tool/sqlmap/types/sqlmap.types";
import {
  getActionDraftBooleanField,
  getActionDraftStringField,
} from "./action-draft-payload.helpers";

export function mapSqlmapActionDraftFormState(
  toolData: SqlmapToolData,
  formState: Record<string, unknown> | null,
  authenticatedContext: AuthenticatedRequestContextMetadata | null,
) {
  if (!formState) {
    return {
      toolData: setActionDraftAuthentication(toolData, false, authenticatedContext),
      didApply: false,
    };
  }
  const form = { ...toolData.form };
  let didApply = false;

  (["targetUrl", "parameter", "body", "timeLimitSeconds", "extraSafeOptions"] as const).forEach(
    (field) => {
      const value = getActionDraftStringField(formState, field);
      if (value !== undefined) {
        form[field] = value;
        didApply = true;
      }
    },
  );
  const method = getActionDraftStringField(formState, "method")?.toUpperCase();
  if (method === "GET" || method === "POST") {
    form.method = method;
    didApply = true;
  }
  const level = getActionDraftStringField(formState, "level");
  if (level && ["1", "2", "3"].includes(level)) {
    form.level = level;
    didApply = true;
  }
  const risk = getActionDraftStringField(formState, "risk");
  if (risk === "1") {
    form.risk = risk;
    didApply = true;
  }

  const requestedAuthentication =
    getActionDraftBooleanField(formState, "useAuthenticatedContext") ?? false;
  const mappedToolData = setActionDraftAuthentication(
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

function setActionDraftAuthentication(
  toolData: SqlmapToolData,
  useAuthenticatedContext: boolean,
  authenticatedContext: AuthenticatedRequestContextMetadata | null,
): SqlmapToolData {
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
