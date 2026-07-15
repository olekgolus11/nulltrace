import { describe, expect, it } from "bun:test";
import { AuthenticatedRequestContext } from "../../../authentication/model/authenticated-request-context.types";
import { AuthenticatedSitemapCrawlCoordinator } from "../authenticated-sitemap-crawl-coordinator.service";
import { AuthenticatedSitemapCrawlerInput } from "../authenticated-sitemap-crawler.service";

function deferred() {
  let resolve!: () => void;
  const promise = new Promise<void>((nextResolve) => {
    resolve = nextResolve;
  });
  return { promise, resolve };
}

describe("AuthenticatedSitemapCrawlCoordinator", () => {
  it("starts one authenticated crawl for an accepted check and active context", async () => {
    const running = deferred();
    const contextLoaded = deferred();
    const context: AuthenticatedRequestContext = {
      origin: "https://example.com",
      cookies: "session=secret",
      headers: "Authorization: Bearer secret",
      updatedAt: "2026-07-13T10:00:00.000Z",
    };
    const calls: unknown[] = [];
    const coordinator = new AuthenticatedSitemapCrawlCoordinator(
      {
        loadProtectedContext: async () => {
          await contextLoaded.promise;
          return context;
        },
      },
      {
        crawl: (input) => {
          calls.push(input);
          return running.promise;
        },
        requestPause: () => true,
      },
      undefined,
      {
        getMetadata: () => ({
          verificationUrl: "https://example.com/account",
        }),
      },
    );

    const firstStart = coordinator.startAfterAcceptedAuthCheck({
      sessionId: "session-1",
      targetId: "target-1",
      rootUrl: "https://example.com/app",
    });
    const secondStart = coordinator.startAfterAcceptedAuthCheck({
      sessionId: "session-1",
      targetId: "target-1",
      rootUrl: "https://example.com/app",
    });
    contextLoaded.resolve();
    const [first, second] = await Promise.all([firstStart, secondStart]);

    expect(first.state).toBe("started");
    expect(second.state).toBe("already_running");
    expect(calls).toEqual([
      {
        sessionId: "session-1",
        targetId: "target-1",
        rootUrl: "https://example.com/app",
        verificationUrl: "https://example.com/account",
        context,
        mode: "fresh",
      },
    ]);
    running.resolve();
    await first.crawl;
  });

  it("does not start when accepted check has no active protected context", async () => {
    const coordinator = new AuthenticatedSitemapCrawlCoordinator(
      { loadProtectedContext: async () => null },
      { crawl: async () => undefined, requestPause: () => false },
    );

    expect(
      await coordinator.startAfterAcceptedAuthCheck({
        sessionId: "session-1",
        targetId: "target-1",
        rootUrl: "https://example.com",
      }),
    ).toEqual({ state: "context_unavailable", crawl: null });
  });

  it("requires renewed Auth Check before resuming recovered work", async () => {
    const calls: AuthenticatedSitemapCrawlerInput[] = [];
    const coordinator = new AuthenticatedSitemapCrawlCoordinator(
      {
        loadProtectedContext: async () => ({
          origin: "https://example.com",
          cookies: "renewed=secret",
          headers: "",
          updatedAt: "2026-07-15T10:00:00.000Z",
        }),
      },
      {
        crawl: async (input) => {
          calls.push(input);
        },
        requestPause: () => false,
      },
      {
        getAuthenticatedCrawlStatus: (sessionId, targetId) => ({
          sessionId,
          targetId,
          status: "authentication_required",
          startedAt: null,
          completedAt: null,
          pausedAt: null,
          failedAt: null,
          errorMessage: null,
          updatedAt: null,
        }),
      },
    );
    const input = {
      sessionId: "session-1",
      targetId: "target-1",
      rootUrl: "https://example.com",
    };

    expect(await coordinator.resumePausedCrawl(input)).toEqual({
      state: "auth_check_required",
      crawl: null,
    });
    expect(calls).toHaveLength(0);

    const renewed = await coordinator.startAfterAcceptedAuthCheck(input);
    expect(renewed.state).toBe("started");
    expect(calls[0]?.mode).toBe("resume");
  });

  it("restarts an authenticated crawl from a fresh seed", async () => {
    const calls: AuthenticatedSitemapCrawlerInput[] = [];
    const coordinator = new AuthenticatedSitemapCrawlCoordinator(
      {
        loadProtectedContext: async () => ({
          origin: "https://example.com",
          cookies: "session=secret",
          headers: "",
          updatedAt: "2026-07-15T10:00:00.000Z",
        }),
      },
      {
        crawl: async (input) => {
          calls.push(input);
        },
        requestPause: () => false,
      },
      {
        getAuthenticatedCrawlStatus: (sessionId, targetId) => ({
          sessionId,
          targetId,
          status: "paused",
          startedAt: null,
          completedAt: null,
          pausedAt: null,
          failedAt: null,
          errorMessage: null,
          updatedAt: null,
        }),
      },
    );

    const result = await coordinator.restartSessionCrawl({
      sessionId: "session-1",
      targetId: "target-1",
      rootUrl: "https://example.com",
    });

    expect(result.state).toBe("started");
    expect(calls[0]?.mode).toBe("fresh");
  });
});
