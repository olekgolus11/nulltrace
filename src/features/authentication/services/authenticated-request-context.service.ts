import {
  AuthenticatedContextInvalidation,
  AuthenticatedRequestContext,
  AuthenticatedRequestContextInput,
} from "../model/authenticated-request-context.types";
import {
  createAuthenticatedRequestContextMetadata,
  splitAuthenticatedHeaderEntries,
} from "./authenticated-request-context-redaction";
import { platformSecretStore, SecretStore } from "./platform-secret-store";
import {
  AuthenticationContextMetadataRepository,
  authenticationContextMetadataRepository,
} from "./authentication-context-metadata.repository";

interface StoredAuthenticatedRequestContext extends AuthenticatedRequestContext {
  version: 1;
}

function getSecretStoreKey(sessionId: string) {
  return `session:${sessionId}:authenticated-request-context`;
}

function parseStoredContext(value: string): StoredAuthenticatedRequestContext | null {
  try {
    const parsed = JSON.parse(value) as unknown;
    if (
      !parsed ||
      typeof parsed !== "object" ||
      !(
        "version" in parsed &&
        "origin" in parsed &&
        "cookies" in parsed &&
        "headers" in parsed &&
        "updatedAt" in parsed
      )
    ) {
      return null;
    }
    const context = parsed as StoredAuthenticatedRequestContext;
    if (
      context.version !== 1 ||
      typeof context.origin !== "string" ||
      typeof context.cookies !== "string" ||
      typeof context.headers !== "string" ||
      typeof context.updatedAt !== "string"
    ) {
      return null;
    }
    return {
      ...context,
      importSource:
        context.importSource === "curl" || context.importSource === "har"
          ? context.importSource
          : "manual",
    };
  } catch {
    return null;
  }
}

function validateHeaders(headers: string) {
  const entries = splitAuthenticatedHeaderEntries(headers);
  const invalidHeader = entries.find((entry) => {
    const separatorIndex = entry.indexOf(":");
    return separatorIndex <= 0 || !entry.slice(separatorIndex + 1).trim();
  });
  if (invalidHeader) {
    throw new Error("Each request header must use the Name: value format.");
  }
}

export function normalizeExactOrigin(value: string) {
  const url = new URL(value);
  if (url.protocol !== "https:" && url.protocol !== "http:") {
    throw new Error("Authentication context requires an HTTP or HTTPS target.");
  }
  return url.origin;
}

export function validateAuthenticatedRequestContextOrigin(
  targetUrl: string,
  contextOrigin: string,
) {
  const targetOrigin = normalizeExactOrigin(targetUrl);
  const normalizedContextOrigin = normalizeExactOrigin(contextOrigin);
  if (targetOrigin !== normalizedContextOrigin) {
    throw new Error(
      "Authentication context must match the session target's exact origin.",
    );
  }
  return targetOrigin;
}

export class AuthenticatedRequestContextService {
  private readonly invalidationListeners = new Set<
    (invalidation: AuthenticatedContextInvalidation) => void
  >();
  private readonly versions = new Map<string, number>();

  constructor(
    private readonly secretStore: SecretStore = platformSecretStore,
    private readonly metadataRepository: AuthenticationContextMetadataRepository =
      authenticationContextMetadataRepository,
  ) {}

  subscribeToInvalidation(
    listener: (invalidation: AuthenticatedContextInvalidation) => void,
  ) {
    this.invalidationListeners.add(listener);
    return () => {
      this.invalidationListeners.delete(listener);
    };
  }

  getAuthStateVersion(sessionId: string) {
    return this.versions.get(sessionId) ?? 0;
  }

  private invalidate(sessionId: string, reason: AuthenticatedContextInvalidation["reason"]) {
    const version = this.getAuthStateVersion(sessionId) + 1;
    this.versions.set(sessionId, version);
    const invalidation = { sessionId, reason, version } as const;
    this.invalidationListeners.forEach((listener) => listener(invalidation));
  }

  async getMetadata(sessionId: string) {
    const activeMetadata = this.metadataRepository.findBySessionId(sessionId);
    if (activeMetadata) {
      return activeMetadata;
    }
    const stored = await this.secretStore.load(getSecretStoreKey(sessionId));
    if (!stored) {
      return null;
    }
    const context = parseStoredContext(stored.value);
    if (!context) {
      return null;
    }
    return this.metadataRepository.upsert(
      sessionId,
      createAuthenticatedRequestContextMetadata(context, stored.storageMode),
    );
  }

  async loadProtectedContext(
    sessionId: string,
  ): Promise<AuthenticatedRequestContext | null> {
    const stored = await this.secretStore.load(getSecretStoreKey(sessionId));
    if (!stored) {
      return null;
    }

    return parseStoredContext(stored.value);
  }

  async save(
    sessionId: string,
    targetUrl: string,
    input: AuthenticatedRequestContextInput,
  ) {
    const origin = validateAuthenticatedRequestContextOrigin(targetUrl, input.origin);
    const cookies = input.cookies.trim();
    const headers = input.headers.trim();
    if (!cookies && !headers) {
      throw new Error("Enter at least one cookie or request header.");
    }
    validateHeaders(headers);

    const context: StoredAuthenticatedRequestContext = {
      version: 1,
      origin,
      cookies,
      headers,
      importSource: input.importSource ?? "manual",
      updatedAt: new Date().toISOString(),
    };
    const storageMode = await this.secretStore.save(
      getSecretStoreKey(sessionId),
      JSON.stringify(context),
    );
    this.metadataRepository.clear(sessionId);
    this.invalidate(sessionId, "replaced");
    return this.metadataRepository.upsert(
      sessionId,
      createAuthenticatedRequestContextMetadata(context, storageMode),
    );
  }

  async clear(sessionId: string) {
    await this.secretStore.clear(getSecretStoreKey(sessionId));
    this.metadataRepository.clear(sessionId);
    this.invalidate(sessionId, "cleared");
  }
}

export const authenticatedRequestContextService =
  new AuthenticatedRequestContextService();
