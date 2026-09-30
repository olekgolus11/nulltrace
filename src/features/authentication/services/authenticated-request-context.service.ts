import {
  AuthenticatedContextStorageMode,
  AuthenticatedContextInvalidation,
  AuthenticatedRequestContext,
  AuthenticatedRequestContextInput,
} from "../model/authenticated-request-context.types";
import {
  AuthenticationContextClearResult,
} from "../model/authentication-context-state.types";
import { StoredAuthenticatedRequestContext } from "../model/authenticated-request-context-storage.types";
import {
  normalizeAuthenticatedRequestCookies,
  partitionAuthenticatedRequestCookieHeaders,
} from "./authenticated-request-context-cookie.helpers";
import {
  createAuthenticatedRequestContextMetadata,
} from "./authenticated-request-context-redaction";
import { platformSecretStore, SecretStore } from "./platform-secret-store";
import {
  AuthenticationContextMetadataRepository,
  authenticationContextMetadataRepository,
} from "./authentication-context-metadata.repository";
import {
  AuthenticationContextStateRepository,
} from "./authentication-context-state.repository";
import {
  getAuthenticatedRequestContextSecretKey,
  getVersionedAuthenticatedRequestContextSecretKey,
  parseStoredAuthenticatedRequestContext,
} from "./authenticated-request-context-storage.helpers";
import {
  validateAuthenticatedRequestContextOrigin,
  validateAuthenticatedRequestHeaders,
} from "./authenticated-request-context-validation.helpers";
import {
  hasAuthenticatedRequestBrowserStorage,
  normalizeAuthenticatedRequestBrowserStorage,
} from "./authenticated-request-browser-storage.helpers";

export class AuthenticatedRequestContextService {
  private readonly invalidationListeners = new Set<
    (invalidation: AuthenticatedContextInvalidation) => void
  >();

  constructor(
    private readonly secretStore: SecretStore = platformSecretStore,
    private readonly metadataRepository: AuthenticationContextMetadataRepository = authenticationContextMetadataRepository,
    stateRepository?: AuthenticationContextStateRepository,
  ) {
    this.stateRepository =
      stateRepository ?? metadataRepository.createContextStateRepository();
  }

  private readonly stateRepository: AuthenticationContextStateRepository;

  subscribeToInvalidation(listener: (invalidation: AuthenticatedContextInvalidation) => void) {
    this.invalidationListeners.add(listener);
    return () => {
      this.invalidationListeners.delete(listener);
    };
  }

  getAuthStateVersion(sessionId: string) {
    return this.stateRepository.find(sessionId)?.generation ?? 0;
  }

  private invalidate(
    sessionId: string,
    reason: AuthenticatedContextInvalidation["reason"],
    version: number,
  ) {
    const invalidation = { sessionId, reason, version } as const;
    for (const listener of this.invalidationListeners) {
      try {
        listener(invalidation);
      } catch {
        // Revocation notification must continue even if one subscriber fails.
      }
    }
  }

  private async loadValidatedContext(sessionId: string): Promise<LoadedAuthenticatedContext | null> {
    const initialState = this.stateRepository.find(sessionId);
    if (initialState && initialState.status !== "active") {
      if (initialState.status === "clear_pending") {
        const allDeleted = await this.retryPendingDeletion(sessionId, initialState.generation);
        if (allDeleted) {
          this.stateRepository.confirmClear(sessionId, initialState.generation);
        }
      }
      return null;
    }

    const secretKey = initialState
      ? initialState.generation === 0
        ? getAuthenticatedRequestContextSecretKey(sessionId)
        : getVersionedAuthenticatedRequestContextSecretKey(sessionId, initialState.generation)
      : getAuthenticatedRequestContextSecretKey(sessionId);
    const stored = await this.secretStore.load(secretKey);
    const currentState = this.stateRepository.find(sessionId);

    if (initialState) {
      if (
        initialState.storageMode === null ||
        !currentState ||
        currentState.status !== "active" ||
        currentState.generation !== initialState.generation ||
        currentState.storageMode !== initialState.storageMode
      ) {
        return null;
      }
      await this.retryPendingDeletion(sessionId, initialState.generation);
      const latestState = this.stateRepository.find(sessionId);
      if (
        !latestState ||
        latestState.status !== "active" ||
        latestState.generation !== initialState.generation ||
        latestState.storageMode !== initialState.storageMode
      ) {
        return null;
      }
      if (!stored || stored.storageMode !== initialState.storageMode) {
        return null;
      }
      const context = parseStoredAuthenticatedRequestContext(stored.value, initialState.generation);
      if (!context) {
        return null;
      }
      return { context, generation: initialState.generation, storageMode: initialState.storageMode };
    }

    if (!stored || currentState) {
      return null;
    }
    const legacyContext = parseStoredAuthenticatedRequestContext(stored.value);
    if (!legacyContext || legacyContext.version === 3) {
      return null;
    }
    const adoptedState = this.stateRepository.adoptLegacyContext(sessionId, stored.storageMode);
    if (
      !adoptedState ||
      adoptedState.generation !== 0 ||
      adoptedState.status !== "active" ||
      adoptedState.storageMode !== stored.storageMode
    ) {
      return null;
    }
    const verifiedState = this.stateRepository.find(sessionId);
    if (
      !verifiedState ||
      verifiedState.generation !== adoptedState.generation ||
      verifiedState.status !== "active" ||
      verifiedState.storageMode !== stored.storageMode
    ) {
      return null;
    }
    return {
      context: legacyContext,
      generation: adoptedState.generation,
      storageMode: adoptedState.storageMode,
    };
  }

  async getMetadata(sessionId: string) {
    const loaded = await this.loadValidatedContext(sessionId);
    if (!loaded) {
      return null;
    }
    const state = this.stateRepository.find(sessionId);
    if (
      !state ||
      state.status !== "active" ||
      state.generation !== loaded.generation ||
      state.storageMode !== loaded.storageMode
    ) {
      return null;
    }
    const currentMetadata = this.metadataRepository.findBySessionId(sessionId, loaded.generation);
    if (currentMetadata) {
      return currentMetadata;
    }
    const rebuiltMetadata = this.metadataRepository.upsert(
        sessionId,
        createAuthenticatedRequestContextMetadata(loaded.context, loaded.storageMode),
        loaded.generation,
      );
    return rebuiltMetadata;
  }

  async loadProtectedContext(sessionId: string): Promise<AuthenticatedRequestContext | null> {
    const loaded = await this.loadValidatedContext(sessionId);
    return loaded?.context ?? null;
  }

  async save(sessionId: string, targetUrl: string, input: AuthenticatedRequestContextInput) {
    const origin = validateAuthenticatedRequestContextOrigin(targetUrl, input.origin);
    const rawHeaders = input.headers.trim();
    const browserStorage = normalizeAuthenticatedRequestBrowserStorage(input.browserStorage);
    if (
      !input.cookies.trim() &&
      !rawHeaders &&
      !hasAuthenticatedRequestBrowserStorage(browserStorage)
    ) {
      throw new Error("Enter at least one cookie, request header, or browser storage entry.");
    }
    validateAuthenticatedRequestHeaders(rawHeaders);
    const { headerDerivedCookies, remainingHeaders } =
      partitionAuthenticatedRequestCookieHeaders(rawHeaders);
    const cookies = normalizeAuthenticatedRequestCookies(headerDerivedCookies, [input.cookies]);
    const headers = remainingHeaders.join(" | ");
    if (!cookies && !headers && !hasAuthenticatedRequestBrowserStorage(browserStorage)) {
      throw new Error("Enter at least one cookie, request header, or browser storage entry.");
    }

    const generation = this.stateRepository.beginSave(sessionId);
    this.metadataRepository.clearForGeneration(sessionId, generation);
    this.invalidate(sessionId, "replaced", generation);

    const context: StoredAuthenticatedRequestContext = {
      version: 3,
      generation,
      origin,
      cookies,
      headers,
      importSource: input.importSource ?? "manual",
      updatedAt: new Date().toISOString(),
      ...(browserStorage ? { browserStorage } : {}),
    };
    const secretKey = getVersionedAuthenticatedRequestContextSecretKey(sessionId, generation);
    let storageMode: AuthenticatedContextStorageMode;
    try {
      storageMode = await this.secretStore.save(secretKey, JSON.stringify(context));
    } catch {
      this.stateRepository.markSecretKeyPending(sessionId, generation);
      await this.deleteTrackedSecretKey(sessionId, generation);
      throw new Error("Unable to save protected authentication context. Check the platform secret store.");
    }
    this.stateRepository.markSecretKeyPending(sessionId, generation);
    if (!this.stateRepository.activate(sessionId, generation, storageMode)) {
      await this.deleteTrackedSecretKey(sessionId, generation);
      throw new Error("Authentication context changed while it was being saved. Save it again.");
    }
    await this.retryPendingDeletion(sessionId, generation);
    const metadata = this.metadataRepository.upsert(
      sessionId,
      createAuthenticatedRequestContextMetadata(context, storageMode),
      generation,
    );
    if (!metadata) {
      throw new Error("Authentication context changed while its metadata was being saved.");
    }
    return metadata;
  }

  async clear(sessionId: string): Promise<AuthenticationContextClearResult> {
    const generation = this.stateRepository.beginClear(sessionId);
    this.metadataRepository.clearForGeneration(sessionId, generation);
    this.invalidate(sessionId, "cleared", generation);
    const allDeleted = await this.retryPendingDeletion(sessionId, generation);
    if (allDeleted && this.stateRepository.confirmClear(sessionId, generation)) {
      return { status: "cleared" };
    }
    return { status: "pending" };
  }

  private async retryPendingDeletion(sessionId: string, beforeGeneration: number) {
    for (let batch = 0; batch < 4; batch += 1) {
      const generations = this.stateRepository.findSecretKeyGenerations(sessionId, beforeGeneration);
      if (generations.length === 0) {
        return !this.stateRepository.hasUnsettledSecretWrites(sessionId, beforeGeneration);
      }
      for (const generation of generations) {
        await this.deleteTrackedSecretKey(sessionId, generation);
      }
      const remaining = this.stateRepository.findSecretKeyGenerations(sessionId, beforeGeneration);
      if (remaining.length >= generations.length) {
        return false;
      }
    }
    return (
      this.stateRepository.findSecretKeyGenerations(sessionId, beforeGeneration).length === 0 &&
      !this.stateRepository.hasUnsettledSecretWrites(sessionId, beforeGeneration)
    );
  }

  private async deleteTrackedSecretKey(sessionId: string, generation: number) {
    let result: "cleared" | "pending" = "pending";
    try {
      const key =
        generation === 0
          ? getAuthenticatedRequestContextSecretKey(sessionId)
          : getVersionedAuthenticatedRequestContextSecretKey(sessionId, generation);
      result = await this.secretStore.clearWithResult(key);
    } catch {
      result = "pending";
    }
    if (result === "cleared") {
      this.stateRepository.markSecretKeyDeleted(sessionId, generation);
    }
  }
}

export const authenticatedRequestContextService = new AuthenticatedRequestContextService();

interface LoadedAuthenticatedContext {
  context: StoredAuthenticatedRequestContext;
  generation: number;
  storageMode: AuthenticatedContextStorageMode;
}
