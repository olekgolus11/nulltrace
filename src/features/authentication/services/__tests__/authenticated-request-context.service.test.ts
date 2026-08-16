import { describe, expect, test } from "bun:test";
import { Database } from "bun:sqlite";
import {
  AuthenticatedRequestContextService,
  validateAuthenticatedRequestContextOrigin,
} from "../authenticated-request-context.service";
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

class TestSecretStore implements SecretStore {
  private readonly values = new Map<string, string>();

  constructor(private readonly storageMode: SecretStoreValue["storageMode"] = "secure") {}

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
}

function createMetadataRepository() {
  const database = new Database(":memory:", { create: true, strict: true });
  database.exec("CREATE TABLE sessions (id TEXT PRIMARY KEY);");
  database.exec("INSERT INTO sessions (id) VALUES ('session-1');");
  createAuthenticationContextMetadataTable(database);
  return new AuthenticationContextMetadataRepository(database, "runtime-1");
}

describe("AuthenticatedRequestContextService", () => {
  test("stores only redacted metadata outside the secure-store payload", async () => {
    const metadataRepository = createMetadataRepository();
    const service = new AuthenticatedRequestContextService(
      new TestSecretStore(),
      metadataRepository,
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
    const metadataRepository = createMetadataRepository();
    const service = new AuthenticatedRequestContextService(
      new TestSecretStore(),
      metadataRepository,
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
    const metadataRepository = createMetadataRepository();
    const service = new AuthenticatedRequestContextService(
      new TestSecretStore(),
      metadataRepository,
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
    const service = new AuthenticatedRequestContextService(
      secretStore,
      createMetadataRepository(),
    );

    expect(await service.loadProtectedContext("session-1")).toMatchObject({
      origin: "https://app.example.test",
      cookies: "session=legacy-secret",
      headers: "",
    });
  });

  test("replacement and clearing invalidate dependent auth state", async () => {
    const metadataRepository = createMetadataRepository();
    const service = new AuthenticatedRequestContextService(
      new TestSecretStore(),
      metadataRepository,
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
    await store.clear("session-1");
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
    expect(await store.load("session-1")).toBeNull();
  });
});
