import { Database } from "bun:sqlite";
import { describe, expect, it } from "bun:test";

process.env.NULLTRACE_APP_DATA_DIR = `/tmp/nulltrace-sitemap-repository-test-${crypto.randomUUID()}`;

async function createRepository(database: Database) {
  const { SitemapRepository } = await import("../sitemap.repository");

  return new SitemapRepository(database);
}

function createTestDatabase() {
  const database = new Database(":memory:", {
    create: true,
    strict: true,
  });

  database.exec(`
    CREATE TABLE targets (
      id TEXT PRIMARY KEY,
      normalized_url TEXT NOT NULL UNIQUE,
      display_url TEXT NOT NULL,
      created_at TEXT NOT NULL
    );

    CREATE TABLE target_sitemap_entries (
      id TEXT PRIMARY KEY,
      target_id TEXT NOT NULL,
      normalized_url TEXT NOT NULL,
      path TEXT NOT NULL,
      method TEXT,
      http_status INTEGER,
      source TEXT NOT NULL,
      provenance TEXT NOT NULL DEFAULT 'public',
      depth INTEGER NOT NULL,
      first_seen_at TEXT NOT NULL,
      last_seen_at TEXT NOT NULL,
      created_at TEXT NOT NULL
    );

    CREATE UNIQUE INDEX idx_target_sitemap_entries_target_url_method
      ON target_sitemap_entries(target_id, normalized_url, method)
      WHERE method IS NOT NULL;
    CREATE UNIQUE INDEX idx_target_sitemap_entries_target_url_without_method
      ON target_sitemap_entries(target_id, normalized_url)
      WHERE method IS NULL;

    CREATE TABLE target_sitemap_crawl_statuses (
      target_id TEXT PRIMARY KEY,
      status TEXT NOT NULL,
      started_at TEXT,
      completed_at TEXT,
      failed_at TEXT,
      error_message TEXT,
      updated_at TEXT NOT NULL
    );

    CREATE TABLE authenticated_sitemap_access_observations (
      session_id TEXT NOT NULL,
      target_id TEXT NOT NULL,
      entry_id TEXT NOT NULL,
      http_status INTEGER NOT NULL,
      observed_at TEXT NOT NULL,
      PRIMARY KEY (session_id, entry_id)
    );

    CREATE TABLE authenticated_sitemap_crawl_statuses (
      session_id TEXT PRIMARY KEY,
      target_id TEXT NOT NULL,
      status TEXT NOT NULL,
      started_at TEXT,
      completed_at TEXT,
      paused_at TEXT,
      failed_at TEXT,
      error_message TEXT,
      updated_at TEXT NOT NULL
    );

    CREATE TABLE sitemap_crawl_checkpoints (
      crawler_type TEXT NOT NULL,
      owner_id TEXT NOT NULL,
      target_id TEXT NOT NULL,
      root_url TEXT NOT NULL,
      frontier_json TEXT NOT NULL,
      visited_urls_json TEXT NOT NULL,
      failures_json TEXT NOT NULL,
      pages_fetched INTEGER NOT NULL,
      entries_discovered INTEGER NOT NULL,
      updated_at TEXT NOT NULL,
      PRIMARY KEY (crawler_type, owner_id)
    );
  `);

  database
    .query(
      `INSERT INTO targets (id, normalized_url, display_url, created_at)
       VALUES (?1, ?2, ?3, ?4)`,
    )
    .run(
      "target-1",
      "https://example.com",
      "https://example.com",
      "2026-07-04T10:00:00.000Z",
    );
  database
    .query(
      `INSERT INTO targets (id, normalized_url, display_url, created_at)
       VALUES (?1, ?2, ?3, ?4)`,
    )
    .run(
      "target-2",
      "https://other.example",
      "https://other.example",
      "2026-07-04T10:00:00.000Z",
    );

  return database;
}

describe("SitemapRepository", () => {
  it("upserts duplicate entries for the same target URL and method", async () => {
    const database = createTestDatabase();
    const repository = await createRepository(database);

    const first = repository.upsertEntry({
      targetId: "target-1",
      normalizedUrl: "https://example.com/admin",
      path: "/admin",
      method: "get",
      httpStatus: null,
      source: "html_link",
      depth: 3,
    });
    const second = repository.upsertEntry({
      targetId: "target-1",
      normalizedUrl: "https://example.com/admin",
      path: "/admin",
      method: "GET",
      httpStatus: 200,
      source: "sitemap_xml",
      depth: 1,
    });

    const rowCount = database
      .query<{ count: number }, []>(
        "SELECT COUNT(*) AS count FROM target_sitemap_entries",
      )
      .get();

    expect(rowCount?.count).toBe(1);
    expect(second).toMatchObject({
      id: first.id,
      targetId: "target-1",
      normalizedUrl: "https://example.com/admin",
      path: "/admin",
      method: "GET",
      httpStatus: 200,
      source: "sitemap_xml",
      depth: 1,
      firstSeenAt: first.firstSeenAt,
    });
    expect(second.lastSeenAt >= first.lastSeenAt).toBe(true);
  });

  it("keeps entries separate by target and method", async () => {
    const repository = await createRepository(createTestDatabase());

    repository.upsertEntry({
      targetId: "target-1",
      normalizedUrl: "https://example.com/login",
      path: "/login",
      method: "GET",
      httpStatus: 200,
      source: "html_link",
      depth: 1,
    });
    repository.upsertEntry({
      targetId: "target-1",
      normalizedUrl: "https://example.com/login",
      path: "/login",
      method: "POST",
      httpStatus: 405,
      source: "html_form",
      depth: 1,
    });
    repository.upsertEntry({
      targetId: "target-2",
      normalizedUrl: "https://example.com/login",
      path: "/login",
      method: "GET",
      httpStatus: 200,
      source: "html_link",
      depth: 1,
    });

    expect(repository.listEntries({ targetId: "target-1" }).entries).toHaveLength(
      2,
    );
    expect(repository.listEntries({ targetId: "target-2" }).entries).toHaveLength(
      1,
    );
  });

  it("lists entries with pagination and depth filters", async () => {
    const repository = await createRepository(createTestDatabase());

    [
      ["/", 0],
      ["/about", 1],
      ["/admin", 1],
      ["/admin/users", 2],
      ["/admin/users/1", 3],
    ].forEach(([path, depth]) => {
      repository.upsertEntry({
        targetId: "target-1",
        normalizedUrl: `https://example.com${path === "/" ? "" : path}`,
        path: String(path),
        method: "GET",
        httpStatus: 200,
        source: "html_link",
        depth: Number(depth),
      });
    });

    const depthOne = repository.listEntries({
      targetId: "target-1",
      depth: 1,
    });
    const shallowPage = repository.listEntries({
      targetId: "target-1",
      maxDepth: 2,
      limit: 2,
      offset: 1,
    });

    expect(depthOne.total).toBe(2);
    expect(depthOne.entries.map((entry) => entry.path)).toEqual([
      "/about",
      "/admin",
    ]);
    expect(shallowPage).toMatchObject({
      total: 4,
      limit: 2,
      offset: 1,
    });
    expect(shallowPage.entries.map((entry) => entry.path)).toEqual([
      "/about",
      "/admin",
    ]);
  });

  it("searches entries and retrieves detail within one target", async () => {
    const repository = await createRepository(createTestDatabase());
    const form = repository.upsertEntry({
      targetId: "target-1",
      normalizedUrl: "https://example.com/Admin/Login",
      path: "/Admin/Login",
      method: "POST",
      httpStatus: 403,
      source: "html_form",
      depth: 2,
    });
    repository.upsertEntry({
      targetId: "target-2",
      normalizedUrl: "https://other.example/Admin/Login",
      path: "/Admin/Login",
      method: "POST",
      httpStatus: 403,
      source: "html_form",
      depth: 2,
    });

    const result = repository.listEntries({
      targetId: "target-1",
      path: "admin",
      method: "post",
      httpStatus: 403,
      source: "html_form",
      depth: 2,
    });

    expect(result.entries.map((entry) => entry.id)).toEqual([form.id]);
    expect(repository.findEntryByIdForTarget("target-1", form.id)).toEqual(form);
    expect(repository.findEntryByIdForTarget("target-2", form.id)).toBeNull();
  });

  it("treats SQL wildcard characters as literal path search text", async () => {
    const repository = await createRepository(createTestDatabase());
    const paths = [
      "/file_1",
      "/fileA1",
      "/progress-100%",
      "/progress-100x",
      "/back\\slash",
      "/backXslash",
    ];

    paths.forEach((path) => {
      repository.upsertEntry({
        targetId: "target-1",
        normalizedUrl: `https://example.com${path}`,
        path,
        method: "GET",
        httpStatus: 200,
        source: "html_link",
        depth: 1,
      });
    });

    expect(
      repository
        .listEntries({ targetId: "target-1", path: "file_1" })
        .entries.map((entry) => entry.path),
    ).toEqual(["/file_1"]);
    expect(
      repository
        .listEntries({ targetId: "target-1", path: "100%" })
        .entries.map((entry) => entry.path),
    ).toEqual(["/progress-100%"]);
    expect(
      repository
        .listEntries({ targetId: "target-1", path: "back\\slash" })
        .entries.map((entry) => entry.path),
    ).toEqual(["/back\\slash"]);
  });

  it("tracks crawl status transitions with useful timestamps and errors", async () => {
    const repository = await createRepository(createTestDatabase());

    expect(repository.getCrawlStatus("target-1")).toEqual({
      targetId: "target-1",
      status: "idle",
      startedAt: null,
      completedAt: null,
      failedAt: null,
      errorMessage: null,
      updatedAt: null,
    });

    const running = repository.markCrawlRunning("target-1");
    const failed = repository.markCrawlFailed("target-1", "Request timed out");
    const restarted = repository.markCrawlRunning("target-1");
    const completed = repository.markCrawlCompleted("target-1");

    expect(running).toMatchObject({
      status: "running",
      completedAt: null,
      failedAt: null,
      errorMessage: null,
    });
    expect(running.startedAt).toBeString();
    expect(failed).toMatchObject({
      status: "failed",
      completedAt: null,
      errorMessage: "Request timed out",
    });
    expect(failed.failedAt).toBeString();
    expect(restarted).toMatchObject({
      status: "running",
      completedAt: null,
      failedAt: null,
      errorMessage: null,
    });
    expect(completed).toMatchObject({
      status: "completed",
      failedAt: null,
      errorMessage: null,
    });
    expect(completed.completedAt).toBeString();
  });

  it("merges public and authenticated discovery while keeping access session-scoped", async () => {
    const repository = await createRepository(createTestDatabase());
    const publicEntry = repository.upsertEntry({
      targetId: "target-1",
      normalizedUrl: "https://example.com/account",
      path: "/account",
      method: "GET",
      httpStatus: 200,
      source: "html_link",
      provenance: "public",
      depth: 2,
    });
    const mergedEntry = repository.upsertEntry({
      targetId: "target-1",
      normalizedUrl: "https://example.com/account",
      path: "/account",
      method: "GET",
      httpStatus: null,
      source: "html_link",
      provenance: "authenticated",
      depth: 1,
    });
    repository.upsertAccessObservation({
      sessionId: "session-1",
      targetId: "target-1",
      entryId: mergedEntry.id,
      httpStatus: 200,
    });
    const unobservedEntry = repository.upsertEntry({
      targetId: "target-1",
      normalizedUrl: "https://example.com/settings",
      path: "/settings",
      method: "GET",
      httpStatus: 200,
      source: "html_link",
      provenance: "authenticated",
      depth: 2,
    });

    expect(mergedEntry).toMatchObject({
      id: publicEntry.id,
      provenance: "both",
      depth: 1,
      httpStatus: 200,
    });
    expect(
      repository.listEntries({
        targetId: "target-1",
        provenance: "both",
      }).entries.map((entry) => entry.id),
    ).toEqual([mergedEntry.id]);
    expect(repository.listAccessObservations("session-1")).toEqual([
      expect.objectContaining({
        sessionId: "session-1",
        targetId: "target-1",
        entryId: mergedEntry.id,
        httpStatus: 200,
      }),
    ]);
    expect(repository.listAccessObservations("session-2")).toEqual([]);
    expect(
      repository.listEntries({
        targetId: "target-1",
        accessObservedBySessionId: "session-1",
        hasAccessObservation: true,
      }).entries.map((entry) => entry.id),
    ).toEqual([mergedEntry.id]);
    expect(
      repository.listEntries({
        targetId: "target-1",
        accessObservedBySessionId: "session-1",
        hasAccessObservation: false,
      }).entries.map((entry) => entry.id),
    ).toEqual([unobservedEntry.id]);
  });

  it("records authenticated crawl authentication-required state per session", async () => {
    const repository = await createRepository(createTestDatabase());

    repository.markAuthenticatedCrawlRunning("session-1", "target-1");
    repository.markAuthenticatedCrawlPaused("session-1", "target-1");
    const paused = repository.markAuthenticatedCrawlAuthenticationRequired(
      "session-1",
      "target-1",
      "Authentication required",
    );

    expect(paused).toMatchObject({
      sessionId: "session-1",
      targetId: "target-1",
      status: "authentication_required",
      errorMessage: "Authentication required",
    });
    expect(paused.startedAt).toBeString();
    expect(paused.pausedAt).toBeString();
    expect(repository.getAuthenticatedCrawlStatus("session-2", "target-1"))
      .toMatchObject({ status: "idle", sessionId: "session-2" });
  });

  it("round-trips non-secret crawl checkpoints", async () => {
    const repository = await createRepository(createTestDatabase());

    repository.saveCrawlCheckpoint({
      crawlerType: "authenticated",
      ownerId: "session-1",
      targetId: "target-1",
      rootUrl: "https://example.com",
      frontier: [
        {
          url: "https://example.com/account",
          depth: 1,
          source: "html_link",
        },
      ],
      visitedUrls: ["https://example.com/"],
      failures: [],
      discoveredEntryKeys: ["GET https://example.com/"],
      pagesFetched: 1,
      entriesDiscovered: 2,
    });

    const recovered = repository.getCrawlCheckpoint(
      "authenticated",
      "session-1",
    );
    expect(recovered).toMatchObject({
      crawlerType: "authenticated",
      ownerId: "session-1",
      frontier: [
        {
          url: "https://example.com/account",
          depth: 1,
          source: "html_link",
        },
      ],
      visitedUrls: ["https://example.com/"],
      discoveredEntryKeys: ["GET https://example.com/"],
      pagesFetched: 1,
    });
    expect(JSON.stringify(recovered)).not.toContain("cookie");
    expect(JSON.stringify(recovered)).not.toContain("Authorization");
  });

  it("recovers interrupted public and authenticated crawls safely", async () => {
    const repository = await createRepository(createTestDatabase());
    repository.markCrawlRunning("target-1");
    repository.markAuthenticatedCrawlRunning("session-1", "target-1");
    repository.markAuthenticatedCrawlPaused("session-1", "target-1");

    repository.recoverInterruptedCrawls();

    expect(repository.getCrawlStatus("target-1").status).toBe("paused");
    expect(
      repository.getAuthenticatedCrawlStatus("session-1", "target-1"),
    ).toMatchObject({
      status: "authentication_required",
      errorMessage: "Run Auth Check again to resume after application restart.",
    });
  });
});
