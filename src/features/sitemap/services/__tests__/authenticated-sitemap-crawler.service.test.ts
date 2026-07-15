import { describe, expect, it } from "bun:test";
import {
  AuthenticatedSitemapAccessObservationInput,
  AuthenticatedSitemapCrawlStatus,
  SitemapCrawlCheckpoint,
  UpsertTargetSitemapEntryInput,
} from "../../model/sitemap.types";

process.env.NULLTRACE_APP_DATA_DIR = `/tmp/nulltrace-authenticated-sitemap-crawler-test-${crypto.randomUUID()}`;

async function createCrawler(options: object) {
  const { AuthenticatedSitemapCrawler } = await import(
    "../authenticated-sitemap-crawler.service"
  );
  return new AuthenticatedSitemapCrawler(options);
}

class FakePersistence {
  entries: UpsertTargetSitemapEntryInput[] = [];
  observations: AuthenticatedSitemapAccessObservationInput[] = [];
  status: AuthenticatedSitemapCrawlStatus = "idle";
  checkpoint: SitemapCrawlCheckpoint | null = null;

  upsertEntry(input: UpsertTargetSitemapEntryInput) {
    this.entries.push(input);
    return { id: `entry-${this.entries.length}` };
  }

  upsertAccessObservation(input: AuthenticatedSitemapAccessObservationInput) {
    this.observations.push(input);
  }

  markAuthenticatedCrawlRunning() {
    this.status = "running";
  }

  markAuthenticatedCrawlCompleted() {
    this.status = "completed";
  }

  markAuthenticatedCrawlPaused() {
    this.status = "paused";
  }

  markAuthenticatedCrawlAuthenticationRequired() {
    this.status = "authentication_required";
  }

  markAuthenticatedCrawlFailed() {
    this.status = "failed";
  }

  saveCrawlCheckpoint(input: Omit<SitemapCrawlCheckpoint, "updatedAt">) {
    this.checkpoint = {
      ...input,
      updatedAt: "2026-07-15T10:00:00.000Z",
    };
  }

  getCrawlCheckpoint() {
    return this.checkpoint;
  }

  deleteCrawlCheckpoint() {
    this.checkpoint = null;
  }
}

function html(body: string, init: ResponseInit = {}) {
  return new Response(body, {
    status: 200,
    headers: { "content-type": "text/html", ...init.headers },
    ...init,
  });
}

describe("AuthenticatedSitemapCrawler", () => {
  it("pauses after in-flight work and resumes retained non-secret frontier", async () => {
    const persistence = new FakePersistence();
    let resolveRoot!: (response: Response) => void;
    const rootResponse = new Promise<Response>((resolve) => {
      resolveRoot = resolve;
    });
    const requests: string[] = [];
    const crawler = await createCrawler({
      repository: persistence,
      fetch: async (url: string) => {
        requests.push(url);
        return url.endsWith("/") ? rootResponse : html("done");
      },
    });
    const input = {
      sessionId: "session-1",
      targetId: "target-1",
      rootUrl: "https://example.com",
      context: {
        origin: "https://example.com",
        cookies: "session=secret",
        headers: "Authorization: Bearer secret",
        updatedAt: "2026-07-15T10:00:00.000Z",
      },
    };

    const pausedCrawl = crawler.crawl(input);
    await new Promise((resolve) => setTimeout(resolve, 0));
    crawler.requestPause("session-1");
    resolveRoot(html('<a href="/account">account</a>'));

    expect(await pausedCrawl).toMatchObject({ status: "paused" });
    expect(requests).not.toContain("https://example.com/account");
    expect(persistence.checkpoint?.frontier).toEqual([
      {
        url: "https://example.com/account",
        depth: 1,
        source: "html_link",
      },
    ]);
    expect(JSON.stringify(persistence.checkpoint)).not.toContain("secret");

    expect(await crawler.crawl({ ...input, mode: "resume" })).toMatchObject({
      status: "completed",
      entriesDiscovered: 2,
    });
    expect(requests).toContain("https://example.com/account");
  });

  it("does not schedule authentication confirmation after pause", async () => {
    const persistence = new FakePersistence();
    let resolveProtected!: (response: Response) => void;
    const protectedResponse = new Promise<Response>((resolve) => {
      resolveProtected = resolve;
    });
    const requests: string[] = [];
    const crawler = await createCrawler({
      repository: persistence,
      fetch: async (url: string, init?: RequestInit) => {
        requests.push(`${init?.method ?? "GET"} ${url}`);
        if (url.endsWith("/")) {
          return html('<a href="/protected">protected</a>');
        }
        return protectedResponse;
      },
    });
    const crawl = crawler.crawl({
      sessionId: "session-1",
      targetId: "target-1",
      rootUrl: "https://example.com",
      context: {
        origin: "https://example.com",
        cookies: "session=secret",
        headers: "",
        updatedAt: "2026-07-15T10:00:00.000Z",
      },
    });
    await new Promise((resolve) => setTimeout(resolve, 0));
    crawler.requestPause("session-1");
    resolveProtected(new Response("sign in", { status: 401 }));

    expect(await crawl).toMatchObject({ status: "paused" });
    expect(requests).toEqual([
      "GET https://example.com/",
      "GET https://example.com/protected",
    ]);
  });
  it("uses only safe same-origin retrieval and refuses cross-origin redirects", async () => {
    const persistence = new FakePersistence();
    const requests: Array<{ url: string; method: string }> = [];
    const crawler = await createCrawler({
      repository: persistence,
      fetch: async (url: string, init?: RequestInit) => {
        requests.push({ url, method: init?.method ?? "GET" });
        if (url === "https://example.com/") {
          return html(
            '<a href="/safe">safe</a><a href="https://other.example/private">other</a><form method="post" action="/delete"></form><form method="get" action="/logout"></form>',
          );
        }
        if (url === "https://example.com/safe") {
          return new Response("", {
            status: 302,
            headers: { location: "https://other.example/leak" },
          });
        }
        throw new Error(`Unexpected request: ${url}`);
      },
      limits: { maxDepth: 2, maxPages: 5 },
    });

    const result = await crawler.crawl({
      sessionId: "session-1",
      targetId: "target-1",
      rootUrl: "https://example.com/private/start",
      context: {
        origin: "https://example.com",
        cookies: "session=secret",
        headers: "Authorization: Bearer secret",
        updatedAt: "2026-07-13T10:00:00.000Z",
      },
    });

    expect(result.status).toBe("completed");
    expect(requests).toEqual([
      { url: "https://example.com/", method: "GET" },
      { url: "https://example.com/safe", method: "GET" },
    ]);
    expect(persistence.entries.some((entry) => entry.path === "/delete")).toBe(false);
    expect(persistence.entries.some((entry) => entry.path === "/logout")).toBe(false);
    expect(persistence.entries.every((entry) => entry.provenance === "authenticated")).toBe(true);
    expect(persistence.entries.every((entry) => entry.httpStatus === null)).toBe(true);
    expect(persistence.observations.every((entry) => entry.sessionId === "session-1")).toBe(true);
  });

  it("keeps response cookies within one crawl and discards them afterward", async () => {
    const cookieHeaders: string[] = [];
    let rootRequests = 0;
    const crawler = await createCrawler({
      repository: new FakePersistence(),
      fetch: async (url: string, init?: RequestInit) => {
        cookieHeaders.push(new Headers(init?.headers).get("cookie") ?? "");
        if (url === "https://example.com/") {
          rootRequests += 1;
          return html('<a href="/next">next</a>', {
            headers: {
              "content-type": "text/html",
              "set-cookie": `rotated=run-${rootRequests}; Path=/; HttpOnly`,
            },
          });
        }
        return html("done");
      },
      limits: { maxDepth: 1, maxPages: 2 },
    });
    const input = {
      sessionId: "session-1",
      targetId: "target-1",
      rootUrl: "https://example.com",
      context: {
        origin: "https://example.com",
        cookies: "saved=original",
        headers: "",
        updatedAt: "2026-07-13T10:00:00.000Z",
      },
    };

    await crawler.crawl(input);
    await crawler.crawl(input);

    expect(cookieHeaders).toEqual([
      "saved=original",
      "saved=original; rotated=run-1",
      "saved=original",
      "saved=original; rotated=run-2",
    ]);
    expect(input.context.cookies).toBe("saved=original");
  });

  it("applies every saved header separator supported by authentication contexts", async () => {
    let requestHeaders = new Headers();
    const crawler = await createCrawler({
      repository: new FakePersistence(),
      fetch: async (_url: string, init?: RequestInit) => {
        requestHeaders = new Headers(init?.headers);
        return html("done");
      },
      limits: { maxDepth: 0, maxPages: 1 },
    });

    await crawler.crawl({
      sessionId: "session-1",
      targetId: "target-1",
      rootUrl: "https://example.com",
      context: {
        origin: "https://example.com",
        cookies: "",
        headers: "Authorization: Bearer secret | X-CSRF-Token: csrf-secret",
        updatedAt: "2026-07-13T10:00:00.000Z",
      },
    });

    expect(requestHeaders.get("authorization")).toBe("Bearer secret");
    expect(requestHeaders.get("x-csrf-token")).toBe("csrf-secret");
  });

  it("continues after route denials when the verification URL remains authenticated", async () => {
    const persistence = new FakePersistence();
    const requests: string[] = [];
    const crawler = await createCrawler({
      repository: persistence,
      fetch: async (url: string, init?: RequestInit) => {
        requests.push(`${init?.method ?? "GET"} ${url}`);
        const cookies = new Headers(init?.headers).get("cookie") ?? "";
        if (url.endsWith("/")) {
          return html('<a href="/one">one</a><a href="/two">two</a>');
        }
        if (url.endsWith("/verify")) {
          return cookies === "session=valid"
            ? new Response("", {
                status: 302,
                headers: { location: "/signin" },
              })
            : new Response("sign in", { status: 401 });
        }
        if (url.endsWith("/signin")) {
          return cookies === "session=valid"
            ? html("authenticated account")
            : new Response("sign in", { status: 401 });
        }
        return new Response("forbidden", {
          status: 403,
          headers: { "set-cookie": "session=; Max-Age=0" },
        });
      },
      limits: { maxDepth: 1, maxPages: 5 },
    });

    const result = await crawler.crawl({
      sessionId: "session-1",
      targetId: "target-1",
      rootUrl: "https://example.com",
      verificationUrl: "https://example.com/verify",
      context: {
        origin: "https://example.com",
        cookies: "session=valid",
        headers: "",
        updatedAt: "2026-07-13T10:00:00.000Z",
      },
    });

    expect(result.status).toBe("completed");
    expect(persistence.status).toBe("completed");
    expect(requests).toEqual([
      "GET https://example.com/",
      "GET https://example.com/one",
      "GET https://example.com/verify",
      "GET https://example.com/signin",
      "GET https://example.com/two",
      "GET https://example.com/verify",
      "GET https://example.com/signin",
    ]);
  });

  it("pauses only when the dedicated verification URL also requires authentication", async () => {
    const persistence = new FakePersistence();
    const requests: string[] = [];
    const crawler = await createCrawler({
      repository: persistence,
      fetch: async (url: string, init?: RequestInit) => {
        requests.push(`${init?.method ?? "GET"} ${url}`);
        if (url.endsWith("/")) {
          return html('<a href="/protected">protected</a>');
        }
        return new Response("sign in", { status: 401 });
      },
      limits: { maxDepth: 1, maxPages: 5 },
    });

    const result = await crawler.crawl({
      sessionId: "session-1",
      targetId: "target-1",
      rootUrl: "https://example.com",
      verificationUrl: "https://example.com/verify",
      context: {
        origin: "https://example.com",
        cookies: "session=expired",
        headers: "",
        updatedAt: "2026-07-13T10:00:00.000Z",
      },
    });

    expect(result.status).toBe("authentication_required");
    expect(persistence.status).toBe("authentication_required");
    expect(requests).toEqual([
      "GET https://example.com/",
      "GET https://example.com/protected",
      "GET https://example.com/verify",
    ]);
  });

  it("retries the auth-required page after context renewal", async () => {
    const persistence = new FakePersistence();
    const requests: string[] = [];
    const crawler = await createCrawler({
      repository: persistence,
      fetch: async (url: string, init?: RequestInit) => {
        const cookies = new Headers(init?.headers).get("cookie") ?? "";
        requests.push(`${cookies} ${url}`);
        if (url.endsWith("/")) {
          return html('<a href="/protected">protected</a>');
        }
        if (cookies === "session=fresh" && url.endsWith("/protected")) {
          return html('<a href="/behind-auth">behind auth</a>');
        }
        if (cookies === "session=fresh") {
          return html("done");
        }
        return new Response("sign in", { status: 401 });
      },
      limits: { maxDepth: 2, maxPages: 5 },
    });
    const input = {
      sessionId: "session-1",
      targetId: "target-1",
      rootUrl: "https://example.com",
      verificationUrl: "https://example.com/verify",
      context: {
        origin: "https://example.com",
        cookies: "session=expired",
        headers: "",
        updatedAt: "2026-07-13T10:00:00.000Z",
      },
    };

    expect(await crawler.crawl(input)).toMatchObject({
      status: "authentication_required",
    });
    expect(persistence.checkpoint?.frontier[0]?.url).toBe(
      "https://example.com/protected",
    );
    expect(persistence.checkpoint?.visitedUrls).not.toContain(
      "https://example.com/protected",
    );

    expect(
      await crawler.crawl({
        ...input,
        mode: "resume",
        context: {
          ...input.context,
          cookies: "session=fresh",
        },
      }),
    ).toMatchObject({ status: "completed" });
    expect(requests).toContain(
      "session=fresh https://example.com/protected",
    );
    expect(requests).toContain(
      "session=fresh https://example.com/behind-auth",
    );
  });

  it("pauses when repeated same-origin redirects remain login-like", async () => {
    const persistence = new FakePersistence();
    const requests: string[] = [];
    const crawler = await createCrawler({
      repository: persistence,
      fetch: async (url: string, init?: RequestInit) => {
        requests.push(`${init?.method ?? "GET"} ${url}`);
        if (url === "https://example.com/") {
          return new Response("", {
            status: 302,
            headers: { location: "/signin" },
          });
        }
        if (url === "https://example.com/verify") {
          return new Response("sign in", { status: 401 });
        }
        return html("Continue with SSO");
      },
    });

    const result = await crawler.crawl({
      sessionId: "session-1",
      targetId: "target-1",
      rootUrl: "https://example.com",
      verificationUrl: "https://example.com/verify",
      context: {
        origin: "https://example.com",
        cookies: "session=expired",
        headers: "",
        updatedAt: "2026-07-13T10:00:00.000Z",
      },
    });

    expect(result.status).toBe("authentication_required");
    expect(requests).toEqual([
      "GET https://example.com/",
      "GET https://example.com/signin",
      "GET https://example.com/verify",
    ]);
  });

  it("stops reading an authenticated response at the public byte bound", async () => {
    let wasCancelled = false;
    const body = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(new TextEncoder().encode("1234"));
        controller.enqueue(new TextEncoder().encode("5678"));
      },
      cancel() {
        wasCancelled = true;
      },
    });
    const crawler = await createCrawler({
      repository: new FakePersistence(),
      fetch: async () =>
        new Response(body, { headers: { "content-type": "text/html" } }),
      limits: { maxResponseBytes: 4 },
    });

    const result = await crawler.crawl({
      sessionId: "session-1",
      targetId: "target-1",
      rootUrl: "https://example.com",
      context: {
        origin: "https://example.com",
        cookies: "session=secret",
        headers: "",
        updatedAt: "2026-07-13T10:00:00.000Z",
      },
    });

    expect(result.status).toBe("failed");
    expect(wasCancelled).toBe(true);
  });
});
