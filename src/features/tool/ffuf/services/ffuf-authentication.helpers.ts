import { FfufFieldId, FfufToolData } from "../types/ffuf.types";

export function setFfufAuthenticationAvailability(
  toolData: FfufToolData,
  origin: string | null,
): FfufToolData {
  let isAvailable = false;
  try {
    isAvailable = Boolean(origin && new URL(getFfufTargetUrl(toolData)).origin === origin);
  } catch {
    isAvailable = false;
  }
  return {
    ...toolData,
    form: {
      ...toolData.form,
      isAuthenticatedContextEnabled: isAvailable
        ? toolData.form.isAuthenticatedContextEnabled
        : false,
    },
    authentication: {
      strategy:
        isAvailable && toolData.form.isAuthenticatedContextEnabled ? "session" : "none",
      isAvailable,
      origin,
    },
  } as FfufToolData;
}

export function toggleFfufAuthenticatedContext(toolData: FfufToolData): FfufToolData {
  if (!toolData.authentication.isAvailable) return toolData;
  const isAuthenticatedContextEnabled = !toolData.form.isAuthenticatedContextEnabled;
  return {
    ...toolData,
    form: {
      ...toolData.form,
      isAuthenticatedContextEnabled,
    },
    authentication: {
      ...toolData.authentication,
      strategy: isAuthenticatedContextEnabled ? "session" : "none",
    },
  } as FfufToolData;
}

export function isFfufAuthenticationField(
  field: FfufFieldId | undefined,
): field is "isAuthenticatedContextEnabled" {
  return field === "isAuthenticatedContextEnabled";
}

function getFfufTargetUrl(toolData: FfufToolData) {
  return toolData.mode === "content_discovery"
    ? toolData.form.targetPattern
    : toolData.form.endpoint;
}
