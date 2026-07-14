import { describe, expect, it } from "bun:test";
import { AuthenticatedRequestContext } from "../../../authentication/model/authenticated-request-context.types";
import { AuthenticatedSitemapCrawlCoordinator } from "../authenticated-sitemap-crawl-coordinator.service";

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
        context,
      },
    ]);
    running.resolve();
    await first.crawl;
  });

  it("does not start when accepted check has no active protected context", async () => {
    const coordinator = new AuthenticatedSitemapCrawlCoordinator(
      { loadProtectedContext: async () => null },
      { crawl: async () => undefined },
    );

    expect(
      await coordinator.startAfterAcceptedAuthCheck({
        sessionId: "session-1",
        targetId: "target-1",
        rootUrl: "https://example.com",
      }),
    ).toEqual({ state: "context_unavailable", crawl: null });
  });
});
