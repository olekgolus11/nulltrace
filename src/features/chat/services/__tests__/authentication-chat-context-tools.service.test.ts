import { describe, expect, it } from "bun:test";
import { Database } from "bun:sqlite";
import { ConversationAttachmentRecord } from "../../model/conversation-attachment.types";
import { AuthCheckStatus } from "../../../authentication/model/authenticated-request-context.types";
import {
  AuthenticatedSitemapCrawlStatus,
  TargetSitemapEntryListFilters,
  TargetSitemapEntryListResult,
} from "../../../sitemap/model/sitemap.types";
import { ChatContextToolRegistry } from "../chat-context-tool-registry";
import {
  AuthenticationChatContextToolsService,
  chatContextToolRegistry,
} from "../chat-context-tools.service";
import { AuthenticationContextMetadataRepository } from "../../../authentication/services/authentication-context-metadata.repository";
import { createAuthenticationContextMetadataTable } from "../../../authentication/services/authentication-context-metadata.schema";
import { AuthenticatedRequestContextService } from "../../../authentication/services/authenticated-request-context.service";
import { AuthCheckService } from "../../../authentication/services/auth-check.service";
import { SecretStore, SecretStoreValue } from "../../../authentication/services/platform-secret-store";

class TestSecretStore implements SecretStore {
  private readonly values = new Map<string, string>();

  async save(key: string, value: string) {
    this.values.set(key, value);
    return "secure" as const;
  }

  async load(key: string): Promise<SecretStoreValue | null> {
    const value = this.values.get(key);
    return value === undefined ? null : { value, storageMode: "secure" };
  }

  async clear(key: string) {
    this.values.delete(key);
  }
}

class FakeAttachments {
  findActiveAttachmentByOpenCodeConversationId(id: string) {
    return id === "conversation-1"
      ? {
          sessionId: "session-1",
          opencodeConversationId: id,
          isDefault: true,
          archivedAt: null,
          createdAt: "2026-07-15T10:00:00.000Z",
        } satisfies ConversationAttachmentRecord
      : null;
  }
}

class FakeSessions {
  getSessionById(id: string) {
    return id === "session-1"
      ? {
          id,
          targetId: "target-1",
          normalizedUrl: "https://example.com",
          displayUrl: "example.com",
        }
      : null;
  }
}

class FakeAuthenticationMetadata {
  constructor(
    private readonly status: AuthCheckStatus | "absent" = "verified",
    private readonly isProceedAllowed = status === "verified",
  ) {}

  findBySessionId(sessionId: string) {
    if (sessionId !== "session-1" || this.status === "absent") return null;
    return {
      origin: "https://example.com",
      cookieCount: 2,
      headerNames: ["Authorization", "X-Secret-Header"],
      storageMode: "secure" as const,
      importSource: "har" as const,
      updatedAt: "2026-07-15T10:01:00.000Z",
      authCheck: {
        status: this.status,
        verificationUrl: "https://example.com/account",
        checkedAt: "2026-07-15T10:02:00.000Z",
        acknowledgedAt:
          this.status === "inconclusive" && this.isProceedAllowed
            ? "2026-07-15T10:02:30.000Z"
            : null,
        isProceedAllowed: this.isProceedAllowed,
        summary: "Authenticated behavior differs from public behavior.",
        signals: null,
      },
      cookies: "session=never-return-this",
      headers: "Authorization: Bearer never-return-this",
      evidenceContents: "raw authenticated response",
      redactedValueTokens: ["reconstruction-token"],
      protectedFilePath: "/protected/session.har",
    };
  }
}

class FakeSitemap {
  constructor(
    private readonly status: AuthenticatedSitemapCrawlStatus = "completed",
  ) {}

  getAuthenticatedCrawlStatus(sessionId: string, targetId: string) {
    return {
      sessionId,
      targetId,
      status: this.status,
      startedAt: "2026-07-15T10:02:00.000Z",
      completedAt: "2026-07-15T10:03:00.000Z",
      pausedAt: null,
      failedAt: null,
      errorMessage: null,
      updatedAt: "2026-07-15T10:03:00.000Z",
    };
  }

  listEntries(
    filters: TargetSitemapEntryListFilters,
  ): TargetSitemapEntryListResult {
    const total = filters.provenance === "authenticated" ? 3 : 2;
    return { entries: [], total, limit: 1, offset: 0 };
  }

  listAccessObservations() {
    return [
      {
        sessionId: "session-1",
        targetId: "target-1",
        entryId: "entry-1",
        httpStatus: 200,
        observedAt: "2026-07-15T10:02:30.000Z",
      },
      {
        sessionId: "session-1",
        targetId: "target-1",
        entryId: "entry-2",
        httpStatus: 403,
        observedAt: "2026-07-15T10:02:31.000Z",
      },
    ];
  }
}

function createService(
  status: AuthCheckStatus | "absent" = "verified",
  isProceedAllowed = status === "verified",
  crawlStatus: AuthenticatedSitemapCrawlStatus = "completed",
) {
  return new AuthenticationChatContextToolsService(
    new FakeAttachments(),
    new FakeSessions(),
    new FakeAuthenticationMetadata(status, isProceedAllowed),
    new FakeSitemap(crawlStatus),
  );
}

describe("authentication chat context tools", () => {
  it("returns bounded non-secret posture, import metadata, and crawl coverage", async () => {
    const result = await createService().getContext("conversation-1");

    expect(result).toEqual({
      authentication: {
        posture: "verified",
        origin: "https://example.com",
        importSource: "har",
        credentialTypes: ["cookies", "headers"],
        cookieCount: 2,
        persistenceMode: "secure",
        updatedAt: "2026-07-15T10:01:00.000Z",
        authCheck: expect.objectContaining({
          status: "verified",
          isProceedAllowed: true,
        }),
        operatorGuidance: null,
      },
      authenticatedCrawl: expect.objectContaining({
        status: "completed",
        coverage: {
          authenticatedOnlyEntryCount: 3,
          sharedEntryCount: 2,
          accessObservationCount: 2,
          httpStatusCounts: { "200": 1, "403": 1 },
        },
      }),
    });

    const serialized = JSON.stringify(result);
    expect(serialized).not.toContain("headerNames");
    expect(serialized).not.toContain("Authorization");
    expect(serialized).not.toContain("X-Secret-Header");
    expect(serialized).not.toContain("never-return-this");
    expect(serialized).not.toContain("raw authenticated response");
    expect(serialized).not.toContain("reconstruction-token");
    expect(serialized).not.toContain("/protected/session.har");
    expect(serialized).not.toContain("filePath");
    expect(serialized).not.toContain("evidence");
  });

  it("registers one read without authentication or crawler mutations", () => {
    const registry = new ChatContextToolRegistry(
      createService().createToolDefinitions(),
    );
    const definitions = registry.listDefinitions();
    const names = definitions.map((definition) => definition.name);

    expect(names).toEqual(["get_authentication_context"]);
    expect(Object.keys(definitions[0]?.args ?? {})).toEqual([]);
    expect(
      names.some((name) =>
        /import|clear|check|pause|resume|retry|restart|start|stop/.test(name),
      ),
    ).toBe(false);

    const globalNames = chatContextToolRegistry
      .listDefinitions()
      .map((definition) => definition.name);
    expect(
      globalNames.some((name) =>
        /^(import|clear|check|pause|resume|retry|restart|start|stop)_.*(auth|crawl)|^(auth|crawl)_.*(import|clear|check|pause|resume|retry|restart|start|stop)/.test(
          name,
        ),
      ),
    ).toBe(false);
  });

  it("distinguishes absent, pending, acknowledged, and action-required posture", async () => {
    const cases = [
      ["absent", false, "idle", "absent", true],
      ["absent", false, "authentication_required", "absent", true],
      ["not_checked", false, "idle", "awaiting_verification", true],
      ["inconclusive", true, "completed", "acknowledged_inconclusive", false],
      ["inconclusive", false, "idle", "requires_action", true],
      ["failed", false, "failed", "requires_action", true],
      ["verified", true, "authentication_required", "authentication_required", true],
    ] as const;

    for (const [status, isProceedAllowed, crawlStatus, expected, hasGuidance] of cases) {
      const result = await createService(
        status,
        isProceedAllowed,
        crawlStatus,
      ).getContext("conversation-1");
      expect(result.authentication.posture).toBe(expected);
      if (hasGuidance) {
        expect(result.authentication.operatorGuidance).toBeString();
      } else {
        expect(result.authentication.operatorGuidance).toBeNull();
      }
    }
  });

  it("reads verified posture across the isolated chat process without secret-store access", async () => {
    const database = new Database(":memory:", { create: true, strict: true });
    database.exec("CREATE TABLE sessions (id TEXT PRIMARY KEY);");
    database.exec("INSERT INTO sessions (id) VALUES ('session-1');");
    createAuthenticationContextMetadataTable(database);
    const appWriter = new AuthenticationContextMetadataRepository(
      database,
      "shared-runtime",
    );
    const chatReader = new AuthenticationContextMetadataRepository(
      database,
      "shared-runtime",
    );
    const contextService = new AuthenticatedRequestContextService(
      new TestSecretStore(),
      appWriter,
    );
    await contextService.save("session-1", "https://example.com", {
      origin: "https://example.com",
      cookies: "session=protected-value",
      headers: "Authorization: Bearer protected-value",
      importSource: "curl",
    });
    const authCheck = new AuthCheckService({
      contextService,
      metadataRepository: appWriter,
      fetch: async (_url, init) => {
        const isAuthenticated = new Headers(init?.headers).has("cookie");
        return isAuthenticated
          ? new Response("<html><title>Account</title></html>", {
              status: 200,
              headers: { "content-type": "text/html" },
            })
          : new Response(
              '<html><title>Sign in</title><form><input type="password"></form></html>',
              {
                status: 401,
                headers: { "content-type": "text/html" },
              },
            );
      },
    });
    expect(
      (
        await authCheck.run(
          "session-1",
          "https://example.com",
          "https://example.com/account",
        )
      ).status,
    ).toBe("verified");
    const service = new AuthenticationChatContextToolsService(
      new FakeAttachments(),
      new FakeSessions(),
      chatReader,
      new FakeSitemap(),
    );

    const result = await service.getContext("conversation-1");

    expect(result.authentication).toMatchObject({
      posture: "verified",
      importSource: "curl",
      persistenceMode: "secure",
    });
    expect(JSON.stringify(result)).not.toContain("protected-value");
  });
});
