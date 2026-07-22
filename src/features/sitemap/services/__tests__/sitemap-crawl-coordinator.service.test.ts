import { describe, expect, it } from "bun:test";
import { SitemapCrawlCoordinator } from "../sitemap-crawl-coordinator.service";
import {
  TargetSitemapCrawlStatus,
  TargetSitemapCrawlStatusRecord,
} from "../../model/sitemap.types";

class DeferredPromise<T> {
  promise: Promise<T>;
  resolve!: (value: T) => void;
  reject!: (error: unknown) => void;

  constructor() {
    this.promise = new Promise<T>((resolve, reject) => {
      this.resolve = resolve;
      this.reject = reject;
    });
  }
}

class FakeStatusRepository {
  constructor(private readonly statuses: Record<string, TargetSitemapCrawlStatus>) {}

  getCrawlStatus(targetId: string): TargetSitemapCrawlStatusRecord {
    return {
      targetId,
      status: this.statuses[targetId] ?? "idle",
      startedAt: null,
      completedAt: null,
      failedAt: null,
      errorMessage: null,
      updatedAt: null,
    };
  }
}

class FakeCrawler {
  calls: Array<{
    targetId: string;
    rootUrl: string;
    mode?: "fresh" | "resume";
  }> = [];
  pauseCalls: string[] = [];
  private readonly crawlResult: Promise<unknown>;

  constructor(crawlResult: Promise<unknown> = Promise.resolve()) {
    this.crawlResult = crawlResult;
  }

  crawl(input: { targetId: string; rootUrl: string; mode?: "fresh" | "resume" }) {
    this.calls.push(input);
    return this.crawlResult;
  }

  requestPause(targetId: string) {
    this.pauseCalls.push(targetId);
    return true;
  }
}

describe("SitemapCrawlCoordinator", () => {
  it("starts a crawl when target status is idle", () => {
    const crawler = new FakeCrawler();
    const coordinator = new SitemapCrawlCoordinator(new FakeStatusRepository({}), crawler);

    const result = coordinator.ensureTargetCrawl({
      targetId: "target-1",
      rootUrl: "https://example.com",
    });

    expect(result).toEqual({ state: "started" });
    expect(crawler.calls).toEqual([
      {
        targetId: "target-1",
        rootUrl: "https://example.com",
        mode: "fresh",
      },
    ]);
    expect(coordinator.getRunningCrawlCount()).toBe(1);
  });

  it("reuses an in-memory running crawl for the same target", () => {
    const deferred = new DeferredPromise<void>();
    const crawler = new FakeCrawler(deferred.promise);
    const coordinator = new SitemapCrawlCoordinator(new FakeStatusRepository({}), crawler);

    const first = coordinator.ensureTargetCrawl({
      targetId: "target-1",
      rootUrl: "https://example.com",
    });
    const second = coordinator.ensureTargetCrawl({
      targetId: "target-1",
      rootUrl: "https://example.com",
    });

    expect(first).toEqual({ state: "started" });
    expect(second).toEqual({ state: "already_running" });
    expect(crawler.calls).toHaveLength(1);
  });

  it("restarts a persisted running status without an in-memory crawl", () => {
    const crawler = new FakeCrawler();
    const coordinator = new SitemapCrawlCoordinator(
      new FakeStatusRepository({
        "target-1": "running",
      }),
      crawler,
    );

    const result = coordinator.ensureTargetCrawl({
      targetId: "target-1",
      rootUrl: "https://example.com",
    });

    expect(result).toEqual({ state: "started" });
    expect(crawler.calls).toHaveLength(1);
    expect(crawler.calls[0]?.mode).toBe("resume");
    expect(coordinator.getRunningCrawlCount()).toBe(1);
  });

  it("resumes a durable paused frontier", () => {
    const crawler = new FakeCrawler();
    const coordinator = new SitemapCrawlCoordinator(
      new FakeStatusRepository({ "target-1": "paused" }),
      crawler,
    );

    expect(
      coordinator.ensureTargetCrawl({
        targetId: "target-1",
        rootUrl: "https://example.com",
      }),
    ).toEqual({ state: "paused" });
    expect(crawler.calls).toHaveLength(0);

    expect(
      coordinator.resumeTargetCrawl({
        targetId: "target-1",
        rootUrl: "https://example.com",
      }),
    ).toBe("started");
    expect(crawler.calls[0]?.mode).toBe("resume");
  });

  it("restarts from a fresh seed instead of retained frontier", () => {
    const crawler = new FakeCrawler();
    const coordinator = new SitemapCrawlCoordinator(
      new FakeStatusRepository({ "target-1": "completed" }),
      crawler,
    );

    expect(
      coordinator.restartTargetCrawl({
        targetId: "target-1",
        rootUrl: "https://example.com",
      }),
    ).toBe("started");
    expect(crawler.calls[0]?.mode).toBe("fresh");
  });

  it("reuses completed sitemap data for later sessions", () => {
    const crawler = new FakeCrawler();
    const coordinator = new SitemapCrawlCoordinator(
      new FakeStatusRepository({
        "target-1": "completed",
      }),
      crawler,
    );

    const result = coordinator.ensureTargetCrawl({
      targetId: "target-1",
      rootUrl: "https://example.com",
    });

    expect(result).toEqual({ state: "completed" });
    expect(crawler.calls).toHaveLength(0);
  });

  it("keeps failed crawl status and partial entries without retrying", () => {
    const crawler = new FakeCrawler();
    const coordinator = new SitemapCrawlCoordinator(
      new FakeStatusRepository({
        "target-1": "failed",
      }),
      crawler,
    );

    const result = coordinator.ensureTargetCrawl({
      targetId: "target-1",
      rootUrl: "https://example.com",
    });

    expect(result).toEqual({ state: "failed" });
    expect(crawler.calls).toHaveLength(0);
  });

  it("allows a later ensure after the running crawl settles", async () => {
    const deferred = new DeferredPromise<void>();
    const crawler = new FakeCrawler(deferred.promise);
    const coordinator = new SitemapCrawlCoordinator(new FakeStatusRepository({}), crawler);

    expect(
      coordinator.ensureTargetCrawl({
        targetId: "target-1",
        rootUrl: "https://example.com",
      }),
    ).toEqual({ state: "started" });
    expect(coordinator.getRunningCrawlCount()).toBe(1);

    deferred.resolve();
    await deferred.promise;
    await Promise.resolve();

    expect(coordinator.getRunningCrawlCount()).toBe(0);
    expect(
      coordinator.ensureTargetCrawl({
        targetId: "target-1",
        rootUrl: "https://example.com",
      }),
    ).toEqual({ state: "started" });
    expect(crawler.calls).toHaveLength(2);
  });
});
