import { describe, expect, test } from "bun:test";
import { Database } from "bun:sqlite";
import { AuthenticatedRequestContextService } from "../authenticated-request-context.service";
import { validateAuthenticatedRequestContextOrigin } from "../authenticated-request-context-validation.helpers";
import { createRedactedAuthenticatedRequestContextPreview } from "../authenticated-request-context-redaction";
import {
  MacOSKeychainSecretStoreAdapter,
  PlatformSecretStore,
  PlatformSecretStoreAdapter,
  SecretStore,
  SecretStoreCommandRunner,
  SecretStoreValue,
} from "../platform-secret-store";
import { AuthenticationContextMetadataRepository } from "../authentication-context-metadata.repository";
import { createAuthenticationContextMetadataTable } from "../authentication-context-metadata.schema";
import { AuthenticationContextStateRepository } from "../authentication-context-state.repository";

class TestSecretStore implements SecretStore {
  protected readonly values = new Map<string, string>();

  constructor(
    private readonly storageMode: SecretStoreValue["storageMode"] = "secure",
    private clearResult: "cleared" | "pending" = "cleared",
  ) {}

  async save(key: string, value: string) {
    this.values.set(key, value);
    return this.storageMode;
  }

  async load(key: string) {
    const value = this.values.get(key);
    return value === undefined ? null : { value, storageMode: this.storageMode };
  }

  async clear(key: string) {
    this.values.delete(key);
  }

  async clearWithResult(key: string) {
    if (this.clearResult === "pending") {
      return "pending" as const;
    }
    await this.clear(key);
    return "cleared" as const;
  }

  setClearResult(result: "cleared" | "pending") {
    this.clearResult = result;
  }
}

function createRepositories() {
  const database = new Database(":memory:", { create: true, strict: true });
  database.exec("CREATE TABLE sessions (id TEXT PRIMARY KEY);");
  database.exec("INSERT INTO sessions (id) VALUES ('session-1');");
  database.exec("INSERT INTO sessions (id) VALUES ('session-2');");
  createAuthenticationContextMetadataTable(database);
  return {
    metadataRepository: new AuthenticationContextMetadataRepository(database, "runtime-1"),
    stateRepository: new AuthenticationContextStateRepository(database),
    database,
  };
}

describe("AuthenticatedRequestContextService", () => {
  test("keeps generations durable across service restart without persisting secrets", async () => {
    const { database, metadataRepository, stateRepository } = createRepositories();
    const secretStore = new TestSecretStore();
    const service = new AuthenticatedRequestContextService(secretStore, metadataRepository, stateRepository);
    await service.save("session-1", "https://app.example.test", {
      origin: "https://app.example.test",
      cookies: "session=restart-canary",
      headers: "",
    });

    const storedState = database
      .query("SELECT * FROM session_authentication_context_state")
      .all();
    const storedKeyLedger = database
      .query("SELECT * FROM session_authentication_context_secret_keys")
      .all();
    expect(JSON.stringify(storedState)).not.toContain("restart-canary");
    expect(JSON.stringify(storedKeyLedger)).not.toContain("restart-canary");

    const restarted = new AuthenticatedRequestContextService(
      secretStore,
      new AuthenticationContextMetadataRepository(database, "runtime-1"),
      new AuthenticationContextStateRepository(database),
    );
    expect(restarted.getAuthStateVersion("session-1")).toBe(1);
    expect(await restarted.loadProtectedContext("session-1")).toMatchObject({
      cookies: "session=restart-canary",
    });
    expect(await restarted.getMetadata("session-1")).toMatchObject({
      origin: "https://app.example.test",
      cookieCount: 1,
    });
  });

  test("drops a prior secure value when the replacement existed only in process memory", async () => {
    let available = true;
    const platformValues = new Map<string, string>();
    const adapter: PlatformSecretStoreAdapter = {
      isAvailable: async () => available,
      save: async (key, value) => {
        platformValues.set(key, value);
      },
      load: async (key) => platformValues.get(key) ?? null,
      clear: async (key) => {
        platformValues.delete(key);
      },
    };
    const { database, metadataRepository, stateRepository } = createRepositories();
    const firstStore = new PlatformSecretStore(adapter);
    const firstService = new AuthenticatedRequestContextService(
      firstStore,
      metadataRepository,
      stateRepository,
    );
    await firstService.save("session-1", "https://app.example.test", {
      origin: "https://app.example.test",
      cookies: "session=old-secure-canary",
      headers: "",
    });
    available = false;
    const memoryMetadata = await firstService.save("session-1", "https://app.example.test", {
      origin: "https://app.example.test",
      cookies: "session=memory-only-canary",
      headers: "",
    });
    expect(memoryMetadata.storageMode).toBe("memory");
    available = true;

    const restarted = new AuthenticatedRequestContextService(
      new PlatformSecretStore(adapter),
      new AuthenticationContextMetadataRepository(database, "runtime-2"),
      new AuthenticationContextStateRepository(database),
    );
    expect(await restarted.loadProtectedContext("session-1")).toBeNull();
    expect(await restarted.getMetadata("session-1")).toBeNull();
    expect(platformValues.size).toBe(0);
    expect(JSON.stringify(database.query("SELECT * FROM session_authentication_context_state").all())).not.toContain(
      "old-secure-canary",
    );
  });

  test("keeps a pending deletion tombstone across restart and reconciles it after store recovery", async () => {
    const { database, metadataRepository, stateRepository } = createRepositories();
    const secretStore = new TestSecretStore("secure", "pending");
    const service = new AuthenticatedRequestContextService(secretStore, metadataRepository, stateRepository);
    await service.save("session-1", "https://app.example.test", {
      origin: "https://app.example.test",
      cookies: "session=pending-delete-canary",
      headers: "",
    });

    expect(await service.clear("session-1")).toEqual({ status: "pending" });
    expect(stateRepository.find("session-1")).toMatchObject({ status: "clear_pending" });
    secretStore.setClearResult("cleared");
    const restarted = new AuthenticatedRequestContextService(
      secretStore,
      new AuthenticationContextMetadataRepository(database, "runtime-1"),
      new AuthenticationContextStateRepository(database),
    );
    expect(await restarted.getMetadata("session-1")).toBeNull();
    expect(await restarted.loadProtectedContext("session-1")).toBeNull();
    expect(stateRepository.find("session-1")).toMatchObject({ status: "cleared" });
  });

  test("does not let a late save overwrite or delete a newer generation", async () => {
    let releaseFirstSave = () => {};
    let notifyFirstSaveStarted = () => {};
    const firstSaveStarted = new Promise<void>((resolve) => {
      notifyFirstSaveStarted = resolve;
    });
    const release = new Promise<void>((resolve) => {
      releaseFirstSave = resolve;
    });
    class DeferredFirstSaveStore extends TestSecretStore {
      private saveCount = 0;

      override async save(key: string, value: string) {
        this.saveCount += 1;
        if (this.saveCount === 1) {
          notifyFirstSaveStarted();
          await release;
        }
        this.values.set(key, value);
        return "secure" as const;
      }
    }

    const { database, metadataRepository, stateRepository } = createRepositories();
    const secretStore = new DeferredFirstSaveStore();
    const firstService = new AuthenticatedRequestContextService(secretStore, metadataRepository, stateRepository);
    const secondService = new AuthenticatedRequestContextService(
      secretStore,
      new AuthenticationContextMetadataRepository(database, "runtime-1"),
      new AuthenticationContextStateRepository(database),
    );
    const firstSave = firstService.save("session-1", "https://app.example.test", {
      origin: "https://app.example.test",
      cookies: "session=late-old-value",
      headers: "",
    });
    await firstSaveStarted;
    await secondService.save("session-1", "https://app.example.test", {
      origin: "https://app.example.test",
      cookies: "session=current-value",
      headers: "",
    });
    releaseFirstSave();
    await expect(firstSave).rejects.toThrow("changed while it was being saved");
    expect(await secondService.loadProtectedContext("session-1")).toMatchObject({
      cookies: "session=current-value",
    });
    expect(await secondService.getMetadata("session-1")).toMatchObject({ cookieCount: 1 });
  });

  test("does not clear newer metadata when an older read completes late", async () => {
    let releaseLoad = () => {};
    let notifyLoadStarted = () => {};
    const loadStarted = new Promise<void>((resolve) => {
      notifyLoadStarted = resolve;
    });
    const release = new Promise<void>((resolve) => {
      releaseLoad = resolve;
    });
    class DeferredLoadStore extends TestSecretStore {
      private shouldDelay = true;

      override async load(key: string) {
        if (this.shouldDelay) {
          this.shouldDelay = false;
          notifyLoadStarted();
          await release;
        }
        return super.load(key);
      }
    }

    const { database, metadataRepository, stateRepository } = createRepositories();
    const secretStore = new DeferredLoadStore();
    const service = new AuthenticatedRequestContextService(secretStore, metadataRepository, stateRepository);
    await service.save("session-1", "https://app.example.test", {
      origin: "https://app.example.test",
      cookies: "session=old-context",
      headers: "",
    });
    const oldRead = service.getMetadata("session-1");
    await loadStarted;
    await service.save("session-1", "https://app.example.test", {
      origin: "https://app.example.test",
      cookies: "session=new-context",
      headers: "",
    });
    releaseLoad();
    expect(await oldRead).toBeNull();
    const currentService = new AuthenticatedRequestContextService(
      secretStore,
      new AuthenticationContextMetadataRepository(database, "runtime-1"),
      new AuthenticationContextStateRepository(database),
    );
    expect(await currentService.getMetadata("session-1")).toMatchObject({ cookieCount: 1 });
    expect(await currentService.loadProtectedContext("session-1")).toMatchObject({
      cookies: "session=new-context",
    });
  });

  test("stores only redacted metadata outside the secure-store payload", async () => {
    const { metadataRepository, stateRepository } = createRepositories();
    const service = new AuthenticatedRequestContextService(
      new TestSecretStore(),
      metadataRepository,
      stateRepository,
    );

    const metadata = await service.save("session-1", "https://app.example.test/login", {
      origin: "https://app.example.test",
      cookies: "session=very-secret; csrf=also-secret",
      headers: "Authorization: Bearer never-show | X-CSRF-Token: hidden",
      importSource: "curl",
    });

    expect(metadata).toEqual({
      origin: "https://app.example.test",
      cookieCount: 2,
      headerNames: ["Authorization", "X-CSRF-Token"],
      storageMode: "secure",
      importSource: "curl",
      updatedAt: expect.any(String),
      authCheck: {
        status: "not_checked",
        verificationUrl: null,
        checkedAt: null,
        acknowledgedAt: null,
        isProceedAllowed: false,
        summary: "Authentication context has not been checked.",
        signals: null,
      },
    });
    expect(metadataRepository.findBySessionId("session-1")).toEqual(metadata);
  });

  test("normalizes duplicate cookie names before protected storage", async () => {
    const { metadataRepository, stateRepository } = createRepositories();
    const service = new AuthenticatedRequestContextService(
      new TestSecretStore(),
      metadataRepository,
      stateRepository,
    );

    const metadata = await service.save("session-1", "https://app.example.test", {
      origin: "https://app.example.test",
      cookies:
        "security=impossible-cookie-secret; PHPSESSID=session-id; security=low-cookie-secret",
      headers:
        "Cookie: security=header-cookie-secret | Authorization: Bearer authorization-secret",
    });

    expect(await service.loadProtectedContext("session-1")).toMatchObject({
      cookies: "PHPSESSID=session-id; security=low-cookie-secret",
      headers: "Authorization: Bearer authorization-secret",
    });
    expect(metadata.cookieCount).toBe(2);
    expect(metadata.headerNames).toEqual(["Authorization"]);
    expect(JSON.stringify(metadata)).not.toContain("session-id");
    expect(JSON.stringify(metadata)).not.toContain("header-cookie-secret");
    expect(JSON.stringify(metadata)).not.toContain("authorization-secret");
    expect(JSON.stringify(metadata)).not.toContain("impossible-cookie-secret");
    expect(JSON.stringify(metadata)).not.toContain("low-cookie-secret");
  });

  test("keeps browser storage values only in the protected context", async () => {
    const { metadataRepository, stateRepository } = createRepositories();
    const service = new AuthenticatedRequestContextService(
      new TestSecretStore(),
      metadataRepository,
      stateRepository,
    );

    const metadata = await service.save("session-1", "https://app.example.test", {
      origin: "https://app.example.test",
      cookies: "session=secret-cookie",
      headers: "",
      browserStorage: {
        localStorage: { user: '{"role":"operator","token":"storage-secret"}' },
        sessionStorage: { challenge: "session-storage-secret" },
      },
    });

    expect(metadata.browserStorage).toEqual({
      localStorageEntryCount: 1,
      sessionStorageEntryCount: 1,
    });
    expect(JSON.stringify(metadata)).not.toContain("storage-secret");
    expect(await service.loadProtectedContext("session-1")).toMatchObject({
      browserStorage: {
        localStorage: { user: '{"role":"operator","token":"storage-secret"}' },
        sessionStorage: { challenge: "session-storage-secret" },
      },
    });
  });

  test("loads version one contexts without browser storage", async () => {
    const secretStore = new TestSecretStore();
    await secretStore.save(
      "session:session-1:authenticated-request-context",
      JSON.stringify({
        version: 1,
        origin: "https://app.example.test",
        cookies: "session=legacy-secret",
        headers: "",
        updatedAt: "2026-07-15T10:00:00.000Z",
      }),
    );
    const { database, metadataRepository, stateRepository } = createRepositories();
    const service = new AuthenticatedRequestContextService(
      secretStore,
      metadataRepository,
      stateRepository,
    );

    expect(await service.loadProtectedContext("session-1")).toMatchObject({
      origin: "https://app.example.test",
      cookies: "session=legacy-secret",
      headers: "",
    });
    expect(await service.loadProtectedContext("session-1")).toMatchObject({
      cookies: "session=legacy-secret",
    });
    const restarted = new AuthenticatedRequestContextService(
      secretStore,
      new AuthenticationContextMetadataRepository(database, "runtime-2"),
      new AuthenticationContextStateRepository(database),
    );
    expect(await restarted.loadProtectedContext("session-1")).toMatchObject({
      cookies: "session=legacy-secret",
    });
  });

  test("a clear stays pending while a save can still write, then retries without touching newer keys", async () => {
    let releaseFirstSave = () => {};
    let notifyFirstSaveStarted = () => {};
    const firstSaveStarted = new Promise<void>((resolve) => {
      notifyFirstSaveStarted = resolve;
    });
    const release = new Promise<void>((resolve) => {
      releaseFirstSave = resolve;
    });
    class DeferredFirstSaveStore extends TestSecretStore {
      private saveCount = 0;

      override async save(key: string, value: string) {
        this.saveCount += 1;
        if (this.saveCount === 1) {
          notifyFirstSaveStarted();
          await release;
        }
        this.values.set(key, value);
        return "secure" as const;
      }
    }

    const { database, metadataRepository, stateRepository } = createRepositories();
    const secretStore = new DeferredFirstSaveStore("secure", "cleared");
    const service = new AuthenticatedRequestContextService(secretStore, metadataRepository, stateRepository);
    const lateSave = service.save("session-1", "https://app.example.test", {
      origin: "https://app.example.test",
      cookies: "session=late-write-canary",
      headers: "",
    });
    await firstSaveStarted;
    expect(await service.clear("session-1")).toEqual({ status: "pending" });
    expect(stateRepository.find("session-1")).toMatchObject({ status: "clear_pending" });
    const restartedWhileWriterPending = new AuthenticatedRequestContextService(
      secretStore,
      new AuthenticationContextMetadataRepository(database, "runtime-2"),
      new AuthenticationContextStateRepository(database),
    );
    expect(await restartedWhileWriterPending.clear("session-1")).toEqual({ status: "pending" });
    expect(stateRepository.findSecretKeyGenerations("session-1", 10)).toEqual([]);
    expect(stateRepository.hasUnsettledSecretWrites("session-1", 10)).toBe(true);
    secretStore.setClearResult("pending");
    releaseFirstSave();
    await expect(lateSave).rejects.toThrow("changed while it was being saved");
    expect(stateRepository.findSecretKeyGenerations("session-1", 10)).toContain(1);
    expect(stateRepository.hasUnsettledSecretWrites("session-1", 10)).toBe(false);
    secretStore.setClearResult("cleared");
    const restarted = new AuthenticatedRequestContextService(
      secretStore,
      new AuthenticationContextMetadataRepository(database, "runtime-2"),
      new AuthenticationContextStateRepository(database),
    );
    expect(await restarted.getMetadata("session-1")).toBeNull();
    expect(stateRepository.find("session-1")).toMatchObject({ status: "cleared" });
    expect(stateRepository.findSecretKeyGenerations("session-1", 10)).toEqual([]);
  });

  test("a delayed old-generation clear cannot remove a newer protected value", async () => {
    let releaseOldKeyClear = () => {};
    let notifyOldKeyClear = () => {};
    const oldKeyClearStarted = new Promise<void>((resolve) => {
      notifyOldKeyClear = resolve;
    });
    const release = new Promise<void>((resolve) => {
      releaseOldKeyClear = resolve;
    });
    class DeferredOldKeyClearStore extends TestSecretStore {
      private delayed = false;

      override async clearWithResult(key: string) {
        if (key.endsWith(":generation:1") && !this.delayed) {
          this.delayed = true;
          notifyOldKeyClear();
          await release;
        }
        return super.clearWithResult(key);
      }
    }

    const { database, metadataRepository, stateRepository } = createRepositories();
    const secretStore = new DeferredOldKeyClearStore();
    const service = new AuthenticatedRequestContextService(secretStore, metadataRepository, stateRepository);
    await service.save("session-1", "https://app.example.test", {
      origin: "https://app.example.test",
      cookies: "session=old-key-value",
      headers: "",
    });
    const oldClear = service.clear("session-1");
    await oldKeyClearStarted;

    const newService = new AuthenticatedRequestContextService(
      secretStore,
      new AuthenticationContextMetadataRepository(database, "runtime-1"),
      new AuthenticationContextStateRepository(database),
    );
    await newService.save("session-1", "https://app.example.test", {
      origin: "https://app.example.test",
      cookies: "session=new-key-value",
      headers: "",
    });
    releaseOldKeyClear();
    expect(await oldClear).toEqual({ status: "pending" });
    expect(await newService.loadProtectedContext("session-1")).toMatchObject({
      cookies: "session=new-key-value",
    });
    expect(await newService.getMetadata("session-1")).toMatchObject({ cookieCount: 1 });
  });

  test("notifies remaining invalidation listeners when one listener throws", async () => {
    const { metadataRepository, stateRepository } = createRepositories();
    const service = new AuthenticatedRequestContextService(
      new TestSecretStore(),
      metadataRepository,
      stateRepository,
    );
    const received: number[] = [];
    service.subscribeToInvalidation(() => {
      throw new Error("subscriber failure");
    });
    service.subscribeToInvalidation((invalidation) => received.push(invalidation.version));

    await service.save("session-1", "https://app.example.test", {
      origin: "https://app.example.test",
      cookies: "session=listener-value",
      headers: "",
    });
    expect(received).toEqual([1]);
  });

  test("keeps another session's protected generation intact when one session is cleared", async () => {
    const { metadataRepository, stateRepository } = createRepositories();
    const store = new TestSecretStore();
    const service = new AuthenticatedRequestContextService(store, metadataRepository, stateRepository);
    for (const sessionId of ["session-1", "session-2"]) {
      await service.save(sessionId, "https://app.example.test", {
        origin: "https://app.example.test",
        cookies: `session=${sessionId}-secret`,
        headers: "",
      });
    }
    expect(await service.clear("session-1")).toEqual({ status: "cleared" });
    expect(await service.loadProtectedContext("session-1")).toBeNull();
    expect(await service.loadProtectedContext("session-2")).toMatchObject({
      cookies: "session=session-2-secret",
    });
  });

  test("replacement and clearing invalidate dependent auth state", async () => {
    const { metadataRepository, stateRepository } = createRepositories();
    const service = new AuthenticatedRequestContextService(
      new TestSecretStore(),
      metadataRepository,
      stateRepository,
    );
    const invalidations: string[] = [];
    service.subscribeToInvalidation((invalidation) => {
      invalidations.push(`${invalidation.reason}:${invalidation.version}`);
    });

    await service.save("session-1", "https://app.example.test", {
      origin: "https://app.example.test",
      cookies: "session=first",
      headers: "",
    });
    await service.save("session-1", "https://app.example.test", {
      origin: "https://app.example.test",
      cookies: "session=replacement",
      headers: "",
    });
    await service.clear("session-1");

    expect(invalidations).toEqual(["replaced:1", "replaced:2", "cleared:3"]);
    expect(service.getAuthStateVersion("session-1")).toBe(3);
    expect(await service.getMetadata("session-1")).toBeNull();
    expect(metadataRepository.findBySessionId("session-1")).toBeNull();
  });

  test("rejects a different scheme, port, or origin", () => {
    expect(() =>
      validateAuthenticatedRequestContextOrigin(
        "https://app.example.test:8443/path",
        "https://app.example.test",
      ),
    ).toThrow("exact origin");
    expect(() =>
      validateAuthenticatedRequestContextOrigin(
        "https://app.example.test",
        "http://app.example.test",
      ),
    ).toThrow("exact origin");
  });
});

describe("authenticated request context redaction", () => {
  test("exposes cookie counts and header names without authorization values", () => {
    const preview = createRedactedAuthenticatedRequestContextPreview({
      origin: "https://app.example.test",
      cookies: "session=very-secret; csrf=also-secret",
      headers: "Authorization: Bearer never-show | X-CSRF-Token: hidden",
    });

    expect(preview).toEqual({
      origin: "https://app.example.test",
      cookieCount: 2,
      headerNames: ["Authorization", "X-CSRF-Token"],
      cookiePreview: "2 cookies [redacted]",
      headerPreview: ["Authorization: [redacted]", "X-CSRF-Token: [redacted]"],
    });
    expect(JSON.stringify(preview)).not.toContain("very-secret");
    expect(JSON.stringify(preview)).not.toContain("never-show");
  });
});

describe("PlatformSecretStore", () => {
  test("uses an explicit macOS keychain under an isolated home directory", async () => {
    const commands: string[][] = [];
    const runner: SecretStoreCommandRunner = {
      run: async (command) => {
        commands.push(command);
        return {
          exitCode: 0,
          stdout: command.includes("find-generic-password") ? "protected-value\n" : "",
          stderr: "",
        };
      },
    };
    const keychainPath = "/Users/operator/Library/Keychains/login.keychain-db";
    const adapter = new MacOSKeychainSecretStoreAdapter(runner, keychainPath);

    await adapter.save("session-1", "protected-value");
    expect(await adapter.load("session-1")).toBe("protected-value");
    await adapter.clear("session-1");

    expect(commands).toHaveLength(3);
    commands.forEach((command) => {
      expect(command.at(-1)).toBe(keychainPath);
    });
  });

  test("uses the secure-store contract when an adapter is available", async () => {
    const values = new Map<string, string>();
    const adapter: PlatformSecretStoreAdapter = {
      isAvailable: async () => true,
      save: async (key, value) => {
        values.set(key, value);
      },
      load: async (key) => values.get(key) ?? null,
      clear: async (key) => {
        values.delete(key);
      },
    };
    const store = new PlatformSecretStore(adapter);

    expect(await store.save("session-1", "protected-value")).toBe("secure");
    expect(await store.load("session-1")).toEqual({
      value: "protected-value",
      storageMode: "secure",
    });
    expect(await store.clearWithResult("session-1")).toBe("cleared");
    expect(await store.load("session-1")).toBeNull();
  });

  test("uses an explicit memory-only fallback when the platform store is unavailable", async () => {
    let saveCalls = 0;
    const unavailableAdapter: PlatformSecretStoreAdapter = {
      isAvailable: async () => false,
      save: async () => {
        saveCalls += 1;
      },
      load: async () => null,
      clear: async () => {},
    };
    const store = new PlatformSecretStore(unavailableAdapter);

    expect(await store.save("session-1", "not-on-disk")).toBe("memory");
    expect(saveCalls).toBe(0);
    expect(await store.load("session-1")).toEqual({
      value: "not-on-disk",
      storageMode: "memory",
    });

    await store.clear("session-1");
    expect(await store.clearWithResult("session-1")).toBe("pending");
    expect(await store.load("session-1")).toBeNull();
  });
});
