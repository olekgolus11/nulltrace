import { AuthenticatedRequestContext } from "../../authentication/model/authenticated-request-context.types";
import { AuthenticatedSitemapCrawlStatusRecord } from "../model/sitemap.types";
import { AuthenticatedSitemapCrawlerInput } from "./authenticated-sitemap-crawler.types";

interface AuthenticatedContextLoader {
  loadProtectedContext(sessionId: string): Promise<AuthenticatedRequestContext | null>;
}

interface AuthenticatedCrawlerRunner {
  crawl(input: AuthenticatedSitemapCrawlerInput): Promise<unknown>;
  requestPause(sessionId: string): boolean;
}

interface AuthenticatedCrawlStatusReader {
  getAuthenticatedCrawlStatus(
    sessionId: string,
    targetId: string,
  ): AuthenticatedSitemapCrawlStatusRecord;
}

export interface StartAuthenticatedSitemapCrawlInput {
  sessionId: string;
  targetId: string;
  rootUrl: string;
}

export type StartAuthenticatedSitemapCrawlState =
  | "started"
  | "already_running"
  | "context_unavailable"
  | "auth_check_required"
  | "pause_requested"
  | "unavailable";

export interface StartAuthenticatedSitemapCrawlResult {
  state: StartAuthenticatedSitemapCrawlState;
  crawl: Promise<unknown> | null;
}

export class AuthenticatedSitemapCrawlCoordinator {
  private readonly runningBySessionId = new Map<string, Promise<unknown>>();

  constructor(
    private readonly contextLoader: AuthenticatedContextLoader,
    private readonly crawler: AuthenticatedCrawlerRunner,
    private readonly repository?: AuthenticatedCrawlStatusReader,
  ) {}

  async startAfterAcceptedAuthCheck({
    sessionId,
    targetId,
    rootUrl,
  }: StartAuthenticatedSitemapCrawlInput): Promise<StartAuthenticatedSitemapCrawlResult> {
    const status = this.repository?.getAuthenticatedCrawlStatus(sessionId, targetId).status;
    return this.startWithContext(
      { sessionId, targetId, rootUrl },
      status === "paused" || status === "authentication_required" ? "resume" : "fresh",
    );
  }

  pauseSessionCrawl(sessionId: string): StartAuthenticatedSitemapCrawlResult {
    return this.crawler.requestPause(sessionId)
      ? { state: "pause_requested", crawl: this.runningBySessionId.get(sessionId) ?? null }
      : { state: "unavailable", crawl: null };
  }

  async resumePausedCrawl(
    input: StartAuthenticatedSitemapCrawlInput,
  ): Promise<StartAuthenticatedSitemapCrawlResult> {
    const status = this.repository?.getAuthenticatedCrawlStatus(
      input.sessionId,
      input.targetId,
    ).status;
    if (status === "authentication_required") {
      return { state: "auth_check_required", crawl: null };
    }
    if (status !== "paused") {
      return { state: "unavailable", crawl: null };
    }
    return this.startWithContext(input, "resume");
  }

  async restartSessionCrawl(
    input: StartAuthenticatedSitemapCrawlInput,
  ): Promise<StartAuthenticatedSitemapCrawlResult> {
    const status = this.repository?.getAuthenticatedCrawlStatus(
      input.sessionId,
      input.targetId,
    ).status;
    if (status === "authentication_required") {
      return { state: "auth_check_required", crawl: null };
    }
    const running = this.runningBySessionId.get(input.sessionId);
    if (running) {
      this.crawler.requestPause(input.sessionId);
      void running.finally(() => {
        void this.startWithContext(input, "fresh");
      });
      return { state: "pause_requested", crawl: running };
    }
    return this.startWithContext(input, "fresh");
  }

  private async startWithContext(
    { sessionId, targetId, rootUrl }: StartAuthenticatedSitemapCrawlInput,
    mode: "fresh" | "resume",
  ): Promise<StartAuthenticatedSitemapCrawlResult> {
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

    const crawl = this.crawler.crawl({
      sessionId,
      targetId,
      rootUrl,
      context,
      mode,
    });
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
