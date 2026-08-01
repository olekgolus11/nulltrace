import { describe, expect, test } from "bun:test";
import { Database } from "bun:sqlite";
import {
  AuthCheckService,
  compareAuthCheckSignals,
  createAuthCheckUrlSuggestions,
  validateAuthCheckUrl,
} from "../auth-check.service";
import { AuthenticatedRequestContextService } from "../authenticated-request-context.service";
import { SecretStore, SecretStoreValue } from "../platform-secret-store";
import { AuthenticationContextMetadataRepository } from "../authentication-context-metadata.repository";
import { createAuthenticationContextMetadataTable } from "../authentication-context-metadata.schema";

class TestSecretStore implements SecretStore {
  private readonly values = new Map<string, string>();

  async save(key: string, value: string) {
    this.values.set(key, value);
    return "memory" as const;
  }

  async load(key: string): Promise<SecretStoreValue | null> {
    const value = this.values.get(key);
    return value === undefined ? null : { value, storageMode: "memory" };
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

function createSignals(
  overrides: {
    unauthenticatedStatus?: number;
    authenticatedStatus?: number;
    unauthenticatedRedirects?: string[];
    authenticatedRedirects?: string[];
    unauthenticatedContentType?: string;
    authenticatedContentType?: string;
    unauthenticatedFingerprint?: string;
    authenticatedFingerprint?: string;
    unauthenticatedTitle?: string | null;
    authenticatedTitle?: string | null;
    unauthenticatedHasLoginForm?: boolean;
    authenticatedHasLoginForm?: boolean;
  } = {},
) {
  return {
    unauthenticated: {
      status: overrides.unauthenticatedStatus ?? 200,
      redirects: overrides.unauthenticatedRedirects ?? [],
      contentType: overrides.unauthenticatedContentType ?? "text/html",
      contentFingerprint: overrides.unauthenticatedFingerprint ?? "same",
      title: overrides.unauthenticatedTitle ?? "Dashboard",
      hasLoginForm: overrides.unauthenticatedHasLoginForm ?? false,
    },
    authenticated: {
      status: overrides.authenticatedStatus ?? 200,
      redirects: overrides.authenticatedRedirects ?? [],
      contentType: overrides.authenticatedContentType ?? "text/html",
      contentFingerprint: overrides.authenticatedFingerprint ?? "same",
      title: overrides.authenticatedTitle ?? "Dashboard",
      hasLoginForm: overrides.authenticatedHasLoginForm ?? false,
    },
  };
}

describe("Auth Check response comparison", () => {
  test("verifies a context when bounded signals show a login-to-app transition", () => {
    const result = compareAuthCheckSignals(
      createSignals({
        unauthenticatedStatus: 401,
        authenticatedStatus: 200,
        unauthenticatedRedirects: ["/login"],
        authenticatedRedirects: [],
        unauthenticatedContentType: "text/html",
        authenticatedContentType: "application/json",
        unauthenticatedFingerprint: "login-page",
        authenticatedFingerprint: "dashboard-page",
        unauthenticatedTitle: "Sign in",
        authenticatedTitle: "Dashboard",
        unauthenticatedHasLoginForm: true,
        authenticatedHasLoginForm: false,
      }),
    );

    expect(result.status).toBe("verified");
    expect(result.isProceedAllowed).toBe(true);
    expect(result.signals).toMatchObject({
      hasStatusChanged: true,
      hasRedirectsChanged: true,
      hasContentTypeChanged: true,
      hasContentFingerprintChanged: true,
      hasTitleChanged: true,
      hasLoginFormChanged: true,
    });
    expect(result.summary.toLowerCase()).not.toContain("authorization proof");
  });

  test("keeps a fingerprint-only difference inconclusive", () => {
    const result = compareAuthCheckSignals(
      createSignals({ authenticatedFingerprint: "personalized-page" }),
    );

    expect(result.status).toBe("inconclusive");
    expect(result.isProceedAllowed).toBe(false);
    expect(result.signals.hasContentFingerprintChanged).toBe(true);
  });

  test("fails when the authenticated response still presents the login form", () => {
    const result = compareAuthCheckSignals(
      createSignals({
        unauthenticatedTitle: "Sign in",
        authenticatedTitle: "Sign in",
        unauthenticatedHasLoginForm: true,
        authenticatedHasLoginForm: true,
      }),
    );

    expect(result.status).toBe("failed");
    expect(result.isProceedAllowed).toBe(false);
  });

  test("fails when the authenticated response returns an error status", () => {
    const result = compareAuthCheckSignals(createSignals({ authenticatedStatus: 500 }));

    expect(result.status).toBe("failed");
    expect(result.isProceedAllowed).toBe(false);
  });

  test("fails when the authenticated response redirects off origin", () => {
    const result = compareAuthCheckSignals(
      createSignals({ authenticatedRedirects: ["cross-origin"] }),
    );

    expect(result.status).toBe("failed");
    expect(result.isProceedAllowed).toBe(false);
  });
});

describe("Auth Check URL selection", () => {
  test("accepts exact-origin URLs and rejects scheme, port, and host changes", () => {
    expect(
      validateAuthCheckUrl(
        "https://app.example.test/root",
        "https://app.example.test/account#profile",
      ),
    ).toBe("https://app.example.test/account");
    expect(() =>
      validateAuthCheckUrl("https://app.example.test", "http://app.example.test/account"),
    ).toThrow("exact origin");
    expect(() =>
      validateAuthCheckUrl("https://app.example.test", "https://app.example.test:8443/account"),
    ).toThrow("exact origin");
    expect(() =>
      validateAuthCheckUrl("https://app.example.test", "https://api.example.test/account"),
    ).toThrow("exact origin");
  });

  test("suggests target root and known same-origin sitemap routes only", () => {
    expect(
      createAuthCheckUrlSuggestions("https://app.example.test/base", [
        "https://app.example.test/admin",
        "https://other.example.test/private",
        "https://app.example.test/admin#section",
        "https://app.example.test/profile",
      ]),
    ).toEqual([
      "https://app.example.test/",
      "https://app.example.test/admin",
      "https://app.example.test/profile",
    ]);
  });
});

describe("Auth Check state", () => {
  test("uses the same normalized cookie selection as Page Inspection", async () => {
    const metadataRepository = createMetadataRepository();
    const contextService = new AuthenticatedRequestContextService(
      new TestSecretStore(),
      metadataRepository,
    );
    await contextService.save("session-1", "https://app.example.test", {
      origin: "https://app.example.test",
      cookies: "security=impossible; PHPSESSID=session-id; security=low",
      headers: "Cookie: security=header-value",
    });
    const authenticatedCookies: string[] = [];
    const authCheckService = new AuthCheckService({
      contextService,
      metadataRepository,
      fetch: async (_url, init) => {
        const cookies = new Headers(init?.headers).get("cookie");
        if (cookies) {
          authenticatedCookies.push(cookies);
        }
        return new Response("page", { status: 200 });
      },
    });

    await authCheckService.run(
      "session-1",
      "https://app.example.test",
      "https://app.example.test/security.php",
    );

    expect(authenticatedCookies).toEqual(["PHPSESSID=session-id; security=low"]);
  });

  test("rechecks the stored verification URL with current runtime credentials", async () => {
    const metadataRepository = createMetadataRepository();
    const contextService = new AuthenticatedRequestContextService(
      new TestSecretStore(),
      metadataRepository,
    );
    await contextService.save("session-1", "https://app.example.test", {
      origin: "https://app.example.test",
      cookies: "session=saved",
      headers: "",
    });
    const authenticatedCookies: string[] = [];
    const authCheckService = new AuthCheckService({
      contextService,
      metadataRepository,
      fetch: async (_url, init) => {
        const cookies = new Headers(init?.headers).get("cookie") ?? "";
        if (cookies) {
          authenticatedCookies.push(cookies);
        }
        return cookies === "session=saved" || cookies === "session=rotated"
          ? new Response("account", { status: 200 })
          : new Response("sign in", { status: 401 });
      },
    });
    await authCheckService.run(
      "session-1",
      "https://app.example.test",
      "https://app.example.test/account",
    );

    await expect(
      authCheckService.verify({
        sessionId: "session-1",
        targetUrl: "https://app.example.test",
        cookies: "session=rotated",
        headers: "",
      }),
    ).resolves.toBe("valid");
    await expect(
      authCheckService.verify({
        sessionId: "session-1",
        targetUrl: "https://app.example.test",
        cookies: "session=expired",
        headers: "",
      }),
    ).resolves.toBe("invalid");
    expect(authenticatedCookies).toContain("session=rotated");
  });

  test("never forwards context across an off-origin redirect", async () => {
    const metadataRepository = createMetadataRepository();
    const contextService = new AuthenticatedRequestContextService(
      new TestSecretStore(),
      metadataRepository,
    );
    await contextService.save("session-1", "https://app.example.test", {
      origin: "https://app.example.test",
      cookies: "session=secret-value",
      headers: "",
    });
    const requestedUrls: string[] = [];
    const authCheckService = new AuthCheckService({
      contextService,
      metadataRepository,
      fetch: async (url) => {
        requestedUrls.push(url);
        return new Response("", {
          status: 302,
          headers: { location: "https://other.example.test/private" },
        });
      },
    });

    const result = await authCheckService.run(
      "session-1",
      "https://app.example.test",
      "https://app.example.test/account",
    );

    expect(result.status).toBe("failed");
    expect(requestedUrls).toEqual([
      "https://app.example.test/account",
      "https://app.example.test/account",
    ]);
    expect(requestedUrls).not.toContain("https://other.example.test/private");
  });

  test("requires explicit acknowledgement before an inconclusive context may proceed", async () => {
    const metadataRepository = createMetadataRepository();
    const contextService = new AuthenticatedRequestContextService(
      new TestSecretStore(),
      metadataRepository,
    );
    await contextService.save("session-1", "https://app.example.test", {
      origin: "https://app.example.test",
      cookies: "session=secret-value",
      headers: "Authorization: Bearer hidden-value",
    });
    const requests: Array<{ url: string; headers: Headers }> = [];
    const authCheckService = new AuthCheckService({
      contextService,
      metadataRepository,
      fetch: async (url, init) => {
        requests.push({
          url,
          headers: new Headers(init?.headers),
        });
        return new Response("<html><title>Welcome</title><main>Same page</main></html>", {
          headers: { "content-type": "text/html" },
        });
      },
    });

    const result = await authCheckService.run(
      "session-1",
      "https://app.example.test",
      "https://app.example.test/account?access_token=query-secret",
    );

    expect(result.status).toBe("inconclusive");
    expect(authCheckService.isProceedAllowed("session-1")).toBe(false);
    expect(requests).toHaveLength(2);
    expect(requests[0]!.headers.has("cookie")).toBe(false);
    expect(requests[0]!.headers.has("authorization")).toBe(false);
    expect(requests[1]!.headers.get("cookie")).toBe("session=secret-value");
    expect(requests[1]!.headers.get("authorization")).toBe("Bearer hidden-value");
    expect(JSON.stringify(result)).not.toContain("secret-value");
    expect(JSON.stringify(result)).not.toContain("hidden-value");
    expect(JSON.stringify(result)).not.toContain("query-secret");
    expect(result.verificationUrl).toBe("https://app.example.test/account");

    const contextMetadata = await authCheckService.getAuthContextMetadata("session-1");
    expect(contextMetadata?.authCheck.status).toBe("inconclusive");
    expect(JSON.stringify(contextMetadata)).not.toContain("secret-value");
    expect(JSON.stringify(contextMetadata)).not.toContain("hidden-value");

    const acknowledged = authCheckService.acknowledgeInconclusive("session-1");

    expect(acknowledged.status).toBe("inconclusive");
    expect(acknowledged.acknowledgedAt).toEqual(expect.any(String));
    expect(acknowledged.isProceedAllowed).toBe(true);
    expect(authCheckService.isProceedAllowed("session-1")).toBe(true);
    expect(
      new AuthCheckService({
        contextService,
        metadataRepository,
      }).getMetadata("session-1"),
    ).toEqual(acknowledged);
  });

  test("invalidates check state when the protected context is replaced", async () => {
    const metadataRepository = createMetadataRepository();
    const contextService = new AuthenticatedRequestContextService(
      new TestSecretStore(),
      metadataRepository,
    );
    await contextService.save("session-1", "https://app.example.test", {
      origin: "https://app.example.test",
      cookies: "session=first",
      headers: "",
    });
    const authCheckService = new AuthCheckService({
      contextService,
      metadataRepository,
      fetch: async () =>
        new Response("<html><title>Same</title></html>", {
          headers: { "content-type": "text/html" },
        }),
    });
    await authCheckService.run(
      "session-1",
      "https://app.example.test",
      "https://app.example.test/account",
    );
    authCheckService.acknowledgeInconclusive("session-1");

    await contextService.save("session-1", "https://app.example.test", {
      origin: "https://app.example.test",
      cookies: "session=replacement",
      headers: "",
    });

    expect(authCheckService.getMetadata("session-1")).toEqual({
      status: "not_checked",
      verificationUrl: null,
      checkedAt: null,
      acknowledgedAt: null,
      isProceedAllowed: false,
      summary: "Authentication context has not been checked.",
      signals: null,
    });
  });

  test("discards an in-flight result when the protected context changes", async () => {
    const metadataRepository = createMetadataRepository();
    const contextService = new AuthenticatedRequestContextService(
      new TestSecretStore(),
      metadataRepository,
    );
    await contextService.save("session-1", "https://app.example.test", {
      origin: "https://app.example.test",
      cookies: "session=first",
      headers: "",
    });
    let requestCount = 0;
    const authCheckService = new AuthCheckService({
      contextService,
      metadataRepository,
      fetch: async () => {
        requestCount += 1;
        if (requestCount === 1) {
          await contextService.save("session-1", "https://app.example.test", {
            origin: "https://app.example.test",
            cookies: "session=replacement",
            headers: "",
          });
        }
        return new Response("<html><title>Same</title></html>", {
          headers: { "content-type": "text/html" },
        });
      },
    });

    await expect(
      authCheckService.run(
        "session-1",
        "https://app.example.test",
        "https://app.example.test/account",
      ),
    ).rejects.toThrow("context changed");
    expect(requestCount).toBe(1);
    expect(authCheckService.getMetadata("session-1").status).toBe("not_checked");
    expect(authCheckService.isProceedAllowed("session-1")).toBe(false);
  });
});
