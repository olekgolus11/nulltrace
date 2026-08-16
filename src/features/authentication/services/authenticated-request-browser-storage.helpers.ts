import {
  AuthenticatedRequestBrowserStorage,
  AuthenticatedRequestStorageEntries,
} from "../model/authenticated-request-context.types";

const maxBrowserStorageEntriesPerArea = 64;

export function parseAuthenticatedRequestStorageEntries(
  value: string,
  areaName: "localStorage" | "sessionStorage",
): AuthenticatedRequestStorageEntries {
  if (!value.trim()) {
    return {};
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(value);
  } catch {
    throw new Error(`${areaName} must be a valid JSON object.`);
  }
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    throw new Error(`${areaName} must be a JSON object with string values.`);
  }

  return normalizeAuthenticatedRequestStorageEntries(parsed, areaName);
}

export function normalizeAuthenticatedRequestBrowserStorage(
  value: AuthenticatedRequestBrowserStorage | undefined,
): AuthenticatedRequestBrowserStorage | undefined {
  if (!value) {
    return undefined;
  }
  const browserStorage = {
    localStorage: normalizeAuthenticatedRequestStorageEntries(
      value.localStorage,
      "localStorage",
    ),
    sessionStorage: normalizeAuthenticatedRequestStorageEntries(
      value.sessionStorage,
      "sessionStorage",
    ),
  };
  return hasAuthenticatedRequestBrowserStorage(browserStorage) ? browserStorage : undefined;
}

export function hasAuthenticatedRequestBrowserStorage(
  value: AuthenticatedRequestBrowserStorage | undefined,
) {
  return Boolean(
    value &&
      (Object.keys(value.localStorage).length > 0 ||
        Object.keys(value.sessionStorage).length > 0),
  );
}

function normalizeAuthenticatedRequestStorageEntries(
  value: unknown,
  areaName: "localStorage" | "sessionStorage",
): AuthenticatedRequestStorageEntries {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error(`${areaName} must be a JSON object with string values.`);
  }
  const entries = Object.entries(value);
  if (entries.length > maxBrowserStorageEntriesPerArea) {
    throw new Error(`${areaName} cannot contain more than 64 entries.`);
  }
  if (entries.some(([, entryValue]) => typeof entryValue !== "string")) {
    throw new Error(`${areaName} values must all be strings.`);
  }
  return Object.fromEntries(entries) as AuthenticatedRequestStorageEntries;
}
