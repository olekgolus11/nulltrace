import { AuthenticatedRequestContext } from "../../authentication/model/authenticated-request-context.types";
import { AuthenticatedSitemapCrawlerInput } from "./authenticated-sitemap-crawler.service";

interface AuthenticatedContextLoader {
  loadProtectedContext(sessionId: string): Promise<AuthenticatedRequestContext | null>;
}

interface AuthenticatedCrawlerRunner {
  crawl(input: AuthenticatedSitemapCrawlerInput): Promise<unknown>;
}

export interface StartAuthenticatedSitemapCrawlInput {
  sessionId: string;
  targetId: string;
  rootUrl: string;
}

export type StartAuthenticatedSitemapCrawlState =
  | "started"
  | "already_running"
  | "context_unavailable";

export interface StartAuthenticatedSitemapCrawlResult {
  state: StartAuthenticatedSitemapCrawlState;
  crawl: Promise<unknown> | null;
}

export class AuthenticatedSitemapCrawlCoordinator {
  private readonly runningBySessionId = new Map<string, Promise<unknown>>();

  constructor(
    private readonly contextLoader: AuthenticatedContextLoader,
    private readonly crawler: AuthenticatedCrawlerRunner,
  ) {}

  async startAfterAcceptedAuthCheck({
    sessionId,
    targetId,
    rootUrl,
  }: StartAuthenticatedSitemapCrawlInput): Promise<StartAuthenticatedSitemapCrawlResult> {
    const running = this.runningBySessionId.get(sessionId);
    if (running) {
      return { state: "already_running", crawl: running };
    }

    let resolveCrawl!: (value: unknown) => void;
    let rejectCrawl!: (reason: unknown) => void;
    const trackedCrawl = new Promise<unknown>((resolve, reject) => {
      resolveCrawl = resolve;
      rejectCrawl = reject;
    });
    this.runningBySessionId.set(sessionId, trackedCrawl);

    let context: AuthenticatedRequestContext | null;
    try {
      context = await this.contextLoader.loadProtectedContext(sessionId);
    } catch (error) {
      this.runningBySessionId.delete(sessionId);
      rejectCrawl(error);
      void trackedCrawl.catch(() => undefined);
      throw error;
    }
    if (!context) {
      this.runningBySessionId.delete(sessionId);
      resolveCrawl(undefined);
      return { state: "context_unavailable", crawl: null };
    }

    const crawl = this.crawler.crawl({ sessionId, targetId, rootUrl, context });
    void crawl.then(resolveCrawl, rejectCrawl);
    void trackedCrawl
      .catch(() => undefined)
      .finally(() => {
        if (this.runningBySessionId.get(sessionId) === trackedCrawl) {
          this.runningBySessionId.delete(sessionId);
        }
      });
    return { state: "started", crawl: trackedCrawl };
  }
}
