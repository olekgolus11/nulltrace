import { TargetSitemapCrawlStatusRecord } from "../model/sitemap.types";

interface SitemapCrawlStatusReader {
  getCrawlStatus(targetId: string): TargetSitemapCrawlStatusRecord;
}

interface PublicSitemapCrawlerRunner {
  crawl(input: {
    targetId: string;
    rootUrl: string;
  }): Promise<unknown>;
}

export type SitemapCrawlStartState =
  | "started"
  | "already_running"
  | "completed"
  | "failed";

export interface EnsureSitemapCrawlInput {
  targetId: string;
  rootUrl: string;
}

export interface EnsureSitemapCrawlResult {
  state: SitemapCrawlStartState;
}

export class SitemapCrawlCoordinator {
  private readonly runningCrawlsByTargetId = new Map<string, Promise<unknown>>();

  constructor(
    private readonly repository: SitemapCrawlStatusReader,
    private readonly crawler: PublicSitemapCrawlerRunner,
  ) {}

  ensureTargetCrawl({
    targetId,
    rootUrl,
  }: EnsureSitemapCrawlInput): EnsureSitemapCrawlResult {
    if (this.runningCrawlsByTargetId.has(targetId)) {
      return {
        state: "already_running",
      };
    }

    const crawlStatus = this.repository.getCrawlStatus(targetId);

    if (crawlStatus.status === "completed") {
      return {
        state: "completed",
      };
    }

    if (crawlStatus.status === "failed") {
      return {
        state: "failed",
      };
    }

    const crawlPromise = this.crawler
      .crawl({
        targetId,
        rootUrl,
      })
      .catch(() => undefined)
      .finally(() => {
        this.runningCrawlsByTargetId.delete(targetId);
      });

    this.runningCrawlsByTargetId.set(targetId, crawlPromise);

    return {
      state: "started",
    };
  }

  getRunningCrawlCount() {
    return this.runningCrawlsByTargetId.size;
  }
}
