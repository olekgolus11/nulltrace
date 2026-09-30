import { normalizeAuthenticatedRequestBrowserStorage } from "./authenticated-request-browser-storage.helpers";
import { AuthenticatedRequestBrowserStorage } from "../model/authenticated-request-context.types";
import { StoredAuthenticatedRequestContext } from "../model/authenticated-request-context-storage.types";

export function getAuthenticatedRequestContextSecretKey(sessionId: string) {
  return `session:${sessionId}:authenticated-request-context`;
}

export function getVersionedAuthenticatedRequestContextSecretKey(
  sessionId: string,
  generation: number,
) {
  return `${getAuthenticatedRequestContextSecretKey(sessionId)}:generation:${generation}`;
}

export function parseStoredAuthenticatedRequestContext(
  value: string,
  expectedGeneration?: number,
): StoredAuthenticatedRequestContext | null {
  try {
    const parsed: unknown = JSON.parse(value);
    if (!parsed || typeof parsed !== "object") {
      return null;
    }
    const context = parsed as Record<string, unknown>;
    if (
      (context.version !== 1 && context.version !== 2 && context.version !== 3) ||
      typeof context.origin !== "string" ||
      typeof context.cookies !== "string" ||
      typeof context.headers !== "string" ||
      typeof context.updatedAt !== "string"
    ) {
      return null;
    }
    if (expectedGeneration !== undefined) {
      if (
        (expectedGeneration === 0 && context.version !== 1 && context.version !== 2) ||
        (expectedGeneration > 0 &&
          (context.version !== 3 || context.generation !== expectedGeneration))
      ) {
        return null;
      }
    } else if (context.version === 3) {
      return null;
    }
    if (
      context.version === 3 &&
      (!Number.isSafeInteger(context.generation) || (context.generation as number) < 1)
    ) {
      return null;
    }
    const browserStorage = normalizeAuthenticatedRequestBrowserStorage(
      context.browserStorage as AuthenticatedRequestBrowserStorage | undefined,
    );
    return {
      version: context.version,
      ...(context.version === 3 ? { generation: context.generation as number } : {}),
      origin: context.origin,
      cookies: context.cookies,
      headers: context.headers,
      updatedAt: context.updatedAt,
      importSource:
        context.importSource === "curl" || context.importSource === "har"
          ? context.importSource
          : "manual",
      ...(browserStorage ? { browserStorage } : {}),
    };
  } catch {
    return null;
  }
}
