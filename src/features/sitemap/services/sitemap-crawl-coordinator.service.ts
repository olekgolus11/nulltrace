import { TargetSitemapCrawlStatusRecord } from "../model/sitemap.types";
import {
  EnsureSitemapCrawlInput,
  EnsureSitemapCrawlResult,
  SitemapCrawlControlState,
} from "./sitemap-crawl-coordinator.types";

interface SitemapCrawlStatusReader {
  getCrawlStatus(targetId: string): TargetSitemapCrawlStatusRecord;
}

interface PublicSitemapCrawlerRunner {
  crawl(input: {
    targetId: string;
    rootUrl: string;
    mode?: "fresh" | "resume" | "retry_failures";
  }): Promise<unknown>;
  requestPause(targetId: string): boolean;
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

    if (crawlStatus.status === "paused") {
      return {
        state: "paused",
      };
    }

    const mode = crawlStatus.status === "running" ? "resume" : "fresh";
    this.startCrawl({ targetId, rootUrl }, mode);

    return {
      state: "started",
    };
  }

  pauseTargetCrawl(targetId: string): SitemapCrawlControlState {
    return this.crawler.requestPause(targetId)
      ? "pause_requested"
      : "unavailable";
  }

  resumeTargetCrawl(input: EnsureSitemapCrawlInput): SitemapCrawlControlState {
    if (this.runningCrawlsByTargetId.has(input.targetId)) {
      return "already_running";
    }
    if (this.repository.getCrawlStatus(input.targetId).status !== "paused") {
      return "unavailable";
    }
    this.startCrawl(input, "resume");
    return "started";
  }

  retryTargetFailures(input: EnsureSitemapCrawlInput): SitemapCrawlControlState {
    if (this.runningCrawlsByTargetId.has(input.targetId)) {
      return "already_running";
    }
    this.startCrawl(input, "retry_failures");
    return "started";
  }

  restartTargetCrawl(input: EnsureSitemapCrawlInput): SitemapCrawlControlState {
    const running = this.runningCrawlsByTargetId.get(input.targetId);
    if (running) {
      this.crawler.requestPause(input.targetId);
      void running.finally(() => {
        this.startCrawl(input, "fresh");
      });
      return "pause_requested";
    }
    this.startCrawl(input, "fresh");
    return "started";
  }

  private startCrawl(
    { targetId, rootUrl }: EnsureSitemapCrawlInput,
    mode: "fresh" | "resume" | "retry_failures",
  ) {
    const crawlPromise = this.crawler
      .crawl({ targetId, rootUrl, mode })
      .catch(() => undefined)
      .finally(() => {
        this.runningCrawlsByTargetId.delete(targetId);
      });

    this.runningCrawlsByTargetId.set(targetId, crawlPromise);
  }

  getRunningCrawlCount() {
    return this.runningCrawlsByTargetId.size;
  }
}
