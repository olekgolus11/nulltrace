import { describe, expect, it } from "bun:test";
import { PublicSitemapCrawler } from "../public-sitemap-crawler.service";
import { UpsertTargetSitemapEntryInput } from "../../model/sitemap.types";

interface RecordedStatus {
  status: "running" | "completed" | "failed";
  errorMessage?: string;
}

class FakeSitemapRepository {
  entries: UpsertTargetSitemapEntryInput[] = [];
  statuses: RecordedStatus[] = [];

  upsertEntry(input: UpsertTargetSitemapEntryInput) {
    this.entries.push(input);
  }

  markCrawlRunning() {
    this.statuses.push({ status: "running" });
  }

  markCrawlCompleted() {
    this.statuses.push({ status: "completed" });
  }

  markCrawlFailed(_targetId: string, errorMessage: string) {
    this.statuses.push({ status: "failed", errorMessage });
  }
}

function createResponse(
  body: string,
  options: {
    status?: number;
    contentType?: string;
  } = {},
) {
  return new Response(body, {
    status: options.status ?? 200,
    headers: {
      "content-type": options.contentType ?? "text/html",
    },
  });
}

function createMockFetch(responses: Record<string, Response | Error>) {
  const requestedUrls: string[] = [];
  const fetch = async (url: string) => {
    requestedUrls.push(url);
    const response = responses[url];

    if (response instanceof Error) {
      throw response;
    }

    return response ?? createResponse("", { status: 404 });
  };

  return {
    fetch,
    requestedUrls,
  };
}

async function runCrawler({
  responses,
  limits,
}: {
  responses: Record<string, Response | Error>;
  limits?: Parameters<PublicSitemapCrawler["crawl"]>[0]["limits"];
}) {
  const repository = new FakeSitemapRepository();
  const { fetch, requestedUrls } = createMockFetch(responses);
  const crawler = new PublicSitemapCrawler({
    repository,
    fetch,
  });
  const result = await crawler.crawl({
    targetId: "target-1",
    rootUrl: "https://example.com/app",
    limits,
  });

  return {
    repository,
    requestedUrls,
    result,
  };
}

function findEntry(
  entries: UpsertTargetSitemapEntryInput[],
  path: string,
  method = "GET",
) {
  return entries.find((entry) => entry.path === path && entry.method === method);
}

describe("PublicSitemapCrawler", () => {
  it("extracts same-origin HTML links and forms without external URLs", async () => {
    const { repository, requestedUrls, result } = await runCrawler({
      responses: {
        "https://example.com/robots.txt": createResponse("", { status: 404 }),
        "https://example.com/sitemap.xml": createResponse("", { status: 404 }),
        "https://example.com/": createResponse(`
          <html>
            <body>
              <a href="/admin">Admin</a>
              <link rel="stylesheet" href="/styles.css" />
              <a href="https://other.example/private">External</a>
              <form method="post" action="/login"></form>
            </body>
          </html>
        `),
        "https://example.com/admin": createResponse("<html></html>"),
      },
    });

    expect(result).toMatchObject({
      status: "completed",
    });
    expect(findEntry(repository.entries, "/admin")).toMatchObject({
      source: "html_link",
      depth: 1,
    });
    expect(findEntry(repository.entries, "/login", "POST")).toMatchObject({
      source: "html_form",
      depth: 1,
    });
    expect(
      repository.entries.some((entry) =>
        entry.normalizedUrl.includes("other.example"),
      ),
    ).toBe(false);
    expect(requestedUrls).toContain("https://example.com/admin");
    expect(requestedUrls).not.toContain("https://example.com/styles.css");
    expect(requestedUrls).not.toContain("https://other.example/private");
    expect(repository.statuses.at(-1)).toEqual({ status: "completed" });
  });

  it("keeps a form without an action on its current page", async () => {
    const { repository } = await runCrawler({
      responses: {
        "https://example.com/robots.txt": createResponse("", { status: 404 }),
        "https://example.com/sitemap.xml": createResponse("", { status: 404 }),
        "https://example.com/": createResponse(
          '<html><a href="/login">Login</a></html>',
        ),
        "https://example.com/login": createResponse(
          '<html><form method="post"></form></html>',
        ),
      },
    });

    expect(findEntry(repository.entries, "/login", "POST")).toMatchObject({
      source: "html_form",
      depth: 2,
    });
  });

  it("enforces max depth while preserving shallow discoveries", async () => {
    const { repository, requestedUrls } = await runCrawler({
      limits: {
        maxDepth: 1,
      },
      responses: {
        "https://example.com/robots.txt": createResponse("", { status: 404 }),
        "https://example.com/sitemap.xml": createResponse("", { status: 404 }),
        "https://example.com/": createResponse(
          '<html><a href="/level-1">Level 1</a></html>',
        ),
        "https://example.com/level-1": createResponse(
          '<html><a href="/level-2">Level 2</a></html>',
        ),
        "https://example.com/level-2": createResponse("<html></html>"),
      },
    });

    expect(findEntry(repository.entries, "/level-1")).toMatchObject({
      depth: 1,
    });
    expect(findEntry(repository.entries, "/level-2")).toBeUndefined();
    expect(requestedUrls).toContain("https://example.com/level-1");
    expect(requestedUrls).not.toContain("https://example.com/level-2");
  });

  it("counts non-HTML responses against the page request limit", async () => {
    const { requestedUrls } = await runCrawler({
      limits: {
        maxPages: 2,
      },
      responses: {
        "https://example.com/robots.txt": createResponse("", { status: 404 }),
        "https://example.com/sitemap.xml": createResponse("", { status: 404 }),
        "https://example.com/": createResponse(
          '<html><a href="/download">Download</a><a href="/next">Next</a></html>',
        ),
        "https://example.com/download": createResponse("binary", {
          contentType: "application/octet-stream",
        }),
        "https://example.com/next": createResponse("<html></html>"),
      },
    });

    expect(requestedUrls).toContain("https://example.com/download");
    expect(requestedUrls).not.toContain("https://example.com/next");
  });

  it("does not follow an off-origin redirect", async () => {
    const repository = new FakeSitemapRepository();
    const requestedUrls: string[] = [];
    const crawler = new PublicSitemapCrawler({
      repository,
      fetch: async (url: string) => {
        requestedUrls.push(url);
        if (url === "https://example.com/") {
          return new Response("", {
            status: 302,
            headers: {
              location: "https://other.example/private",
            },
          });
        }

        return createResponse("", { status: 404 });
      },
    });

    await crawler.crawl({
      targetId: "target-1",
      rootUrl: "https://example.com",
    });

    expect(requestedUrls).not.toContain("https://other.example/private");
  });

  it("resolves HTML links against the final same-origin redirect URL", async () => {
    const { requestedUrls } = await runCrawler({
      responses: {
        "https://example.com/robots.txt": createResponse("", { status: 404 }),
        "https://example.com/sitemap.xml": createResponse("", { status: 404 }),
        "https://example.com/": new Response("", {
          status: 302,
          headers: {
            location: "/docs/",
          },
        }),
        "https://example.com/docs/": createResponse(
          '<html><a href="page">Page</a></html>',
        ),
        "https://example.com/docs/page": createResponse("<html></html>"),
      },
    });

    expect(requestedUrls).toContain("https://example.com/docs/page");
    expect(requestedUrls).not.toContain("https://example.com/page");
  });

  it("extracts sitemap XML URLs from robots metadata and default sitemap.xml", async () => {
    const { repository, result } = await runCrawler({
      responses: {
        "https://example.com/robots.txt": createResponse(
          [
            "User-agent: *",
            "Sitemap: https://example.com/custom-sitemap.xml",
            "Sitemap: https://other.example/external.xml",
          ].join("\n"),
          { contentType: "text/plain" },
        ),
        "https://example.com/custom-sitemap.xml": createResponse(
          `<?xml version="1.0" encoding="UTF-8"?>
          <urlset>
            <url><loc>https://example.com/from-robots</loc></url>
            <url><loc>https://other.example/ignored</loc></url>
          </urlset>`,
          { contentType: "application/xml" },
        ),
        "https://example.com/sitemap.xml": createResponse(
          `<?xml version="1.0" encoding="UTF-8"?>
          <urlset>
            <url><loc>https://example.com/from-default</loc></url>
          </urlset>`,
          { contentType: "application/xml" },
        ),
        "https://example.com/": createResponse("<html></html>"),
        "https://example.com/from-robots": createResponse("<html></html>"),
        "https://example.com/from-default": createResponse("<html></html>"),
      },
    });

    expect(result.status).toBe("completed");
    expect(findEntry(repository.entries, "/custom-sitemap.xml")).toMatchObject({
      source: "robots_sitemap",
      depth: 0,
    });
    expect(findEntry(repository.entries, "/from-robots")).toMatchObject({
      source: "sitemap_xml",
      depth: 1,
    });
    expect(findEntry(repository.entries, "/from-default")).toMatchObject({
      source: "sitemap_xml",
      depth: 1,
    });
    expect(
      repository.entries.some((entry) =>
        entry.normalizedUrl.includes("other.example"),
      ),
    ).toBe(false);
  });

  it("fails the crawl when an HTML response exceeds the size limit", async () => {
    const { repository, result } = await runCrawler({
      limits: {
        maxResponseBytes: 10,
      },
      responses: {
        "https://example.com/robots.txt": createResponse("", { status: 404 }),
        "https://example.com/sitemap.xml": createResponse("", { status: 404 }),
        "https://example.com/": createResponse("<html>too large</html>"),
      },
    });

    expect(result).toMatchObject({
      status: "failed",
      errorMessage: "Response body exceeded 10 bytes.",
    });
    expect(repository.statuses.at(-1)).toEqual({
      status: "failed",
      errorMessage: "Response body exceeded 10 bytes.",
    });
  });

  it("marks the crawl failed when the required page fetch throws", async () => {
    const { repository, result } = await runCrawler({
      responses: {
        "https://example.com/robots.txt": createResponse("", { status: 404 }),
        "https://example.com/sitemap.xml": createResponse("", { status: 404 }),
        "https://example.com/": new Error("Network unavailable"),
      },
    });

    expect(result).toEqual({
      status: "failed",
      pagesFetched: 0,
      entriesDiscovered: 2,
      errorMessage: "Network unavailable",
    });
    expect(repository.statuses).toEqual([
      { status: "running" },
      {
        status: "failed",
        errorMessage: "Network unavailable",
      },
    ]);
  });
});
