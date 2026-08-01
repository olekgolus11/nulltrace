import { getSqlmapFieldOrder } from "../config/sqlmap.config";
import { SqlmapToolData } from "../types/sqlmap.types";

export function setSqlmapAuthenticationAvailability(
  toolData: SqlmapToolData,
  origin: string | null,
): SqlmapToolData {
  let isAvailable = false;
  try {
    isAvailable = Boolean(origin && new URL(toolData.form.targetUrl).origin === origin);
  } catch {
    isAvailable = false;
  }
  const useAuthenticatedContext = isAvailable
    ? toolData.form.useAuthenticatedContext
    : false;
  return {
    ...toolData,
    selectedField: Math.min(
      toolData.selectedField,
      getSqlmapFieldOrder(isAvailable).length - 1,
    ),
    form: {
      ...toolData.form,
      useAuthenticatedContext,
    },
    authentication: {
      strategy: useAuthenticatedContext ? "session" : "none",
      isAvailable,
      origin,
    },
  };
}

export function toggleSqlmapAuthenticatedContext(toolData: SqlmapToolData): SqlmapToolData {
  if (!toolData.authentication.isAvailable) return toolData;
  const useAuthenticatedContext = !toolData.form.useAuthenticatedContext;
  return {
    ...toolData,
    form: {
      ...toolData.form,
      useAuthenticatedContext,
    },
    authentication: {
      ...toolData.authentication,
      strategy: useAuthenticatedContext ? "session" : "none",
    },
  };
}

export function resetSqlmapRunScopedState(toolData: SqlmapToolData): SqlmapToolData {
  return {
    ...toolData,
    form: {
      ...toolData.form,
      useAuthenticatedContext: false,
    },
    authentication: {
      ...toolData.authentication,
      strategy: "none",
    },
  };
}
