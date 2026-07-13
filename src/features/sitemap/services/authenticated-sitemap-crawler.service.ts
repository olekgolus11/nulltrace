import { load } from "cheerio";
import { AuthenticatedRequestContext } from "../../authentication/model/authenticated-request-context.types";
import {
  AuthenticatedSitemapAccessObservationInput,
  AuthenticatedSitemapCrawlStatus,
  UpsertTargetSitemapEntryInput,
} from "../model/sitemap.types";
import {
  defaultPublicSitemapCrawlerLimits,
  PublicSitemapCrawlerLimits,
  readResponseText,
} from "./public-sitemap-crawler.service";
import { sitemapRepository } from "./sitemap.repository";
import {
  createAbsoluteCrawlUrl,
  normalizeCrawlUrl,
} from "./sitemap-crawler-url";

type FetchFunction = (input: string, init?: RequestInit) => Promise<Response>;

export interface AuthenticatedSitemapCrawlerPersistence {
  upsertEntry(input: UpsertTargetSitemapEntryInput): { id: string };
  upsertAccessObservation(
    input: AuthenticatedSitemapAccessObservationInput,
  ): unknown;
  markAuthenticatedCrawlRunning(sessionId: string, targetId: string): unknown;
  markAuthenticatedCrawlCompleted(sessionId: string, targetId: string): unknown;
  markAuthenticatedCrawlAuthenticationRequired(
    sessionId: string,
    targetId: string,
    errorMessage: string,
  ): unknown;
  markAuthenticatedCrawlFailed(
    sessionId: string,
    targetId: string,
    errorMessage: string,
  ): unknown;
}

export interface AuthenticatedSitemapCrawlerInput {
  sessionId: string;
  targetId: string;
  rootUrl: string;
  context: AuthenticatedRequestContext;
  limits?: Partial<PublicSitemapCrawlerLimits>;
}

export interface AuthenticatedSitemapCrawlerResult {
  status: Extract<
    AuthenticatedSitemapCrawlStatus,
    "completed" | "authentication_required" | "failed"
  >;
  pagesFetched: number;
  entriesDiscovered: number;
  errorMessage?: string;
}

interface AuthenticatedSitemapCrawlerOptions {
  repository?: AuthenticatedSitemapCrawlerPersistence;
  fetch?: FetchFunction;
  limits?: Partial<PublicSitemapCrawlerLimits>;
}

interface QueuedUrl {
  url: URL;
  depth: number;
  source: "seed" | "html_link";
}

const authenticationSignalThreshold = 2;

function parseHeaderLines(value: string) {
  return value
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean);
}

class TemporaryCookieJar {
  private readonly cookies = new Map<string, string>();

  constructor(seed: string) {
    seed.split(";").forEach((pair) => this.setPair(pair));
  }

  getHeader() {
    return [...this.cookies.entries()]
      .map(([name, value]) => `${name}=${value}`)
      .join("; ");
  }

  accept(response: Response) {
    const headers = response.headers as Headers & { getSetCookie?: () => string[] };
    const values = headers.getSetCookie?.() ?? [];
    if (values.length === 0) {
      const combined = response.headers.get("set-cookie");
      if (combined) {
        values.push(combined);
      }
    }
    values.forEach((value) => this.setPair(value.split(";", 1)[0] ?? ""));
  }

  clear() {
    this.cookies.clear();
  }

  private setPair(value: string) {
    const separator = value.indexOf("=");
    if (separator <= 0) {
      return;
    }
    const name = value.slice(0, separator).trim();
    const cookieValue = value.slice(separator + 1).trim();
    if (!name) {
      return;
    }
    if (!cookieValue) {
      this.cookies.delete(name);
      return;
    }
    this.cookies.set(name, cookieValue);
  }
}

function isHtml(response: Response) {
  const contentType = response.headers.get("content-type")?.toLowerCase() ?? "";
  return contentType.includes("text/html") || contentType.includes("application/xhtml+xml");
}

function hasLoginForm(body: string) {
  const $ = load(body);
  return $('form input[type="password"]').length > 0;
}

function isLoginLikeUrl(url: URL) {
  return /(?:^|\/)(?:login|log-in|signin|sign-in|sso|oauth|authorize)(?:\/|$)/i.test(
    url.pathname,
  );
}

function isAuthenticationSignal(
  response: Response,
  url: URL,
  body: string,
  crossOriginRedirectUrl: URL | null,
) {
  return (
    response.status === 401 ||
    response.status === 403 ||
    (crossOriginRedirectUrl !== null && isLoginLikeUrl(crossOriginRedirectUrl)) ||
    isLoginLikeUrl(url) ||
    hasLoginForm(body)
  );
}

function toErrorMessage(error: unknown) {
  return error instanceof Error && error.message
    ? error.message
    : "Authenticated sitemap crawl failed.";
}

export class AuthenticatedSitemapCrawler {
  private readonly repository: AuthenticatedSitemapCrawlerPersistence;
  private readonly fetch: FetchFunction;
  private readonly limits: Partial<PublicSitemapCrawlerLimits>;

  constructor(options: AuthenticatedSitemapCrawlerOptions = {}) {
    this.repository = options.repository ?? sitemapRepository;
    this.fetch = options.fetch ?? globalThis.fetch.bind(globalThis);
    this.limits = options.limits ?? {};
  }

  async crawl(
    input: AuthenticatedSitemapCrawlerInput,
  ): Promise<AuthenticatedSitemapCrawlerResult> {
    const limits = {
      ...defaultPublicSitemapCrawlerLimits,
      ...this.limits,
      ...input.limits,
    };
    const contextOrigin = new URL(input.context.origin).origin;
    const rootOrigin = new URL(input.rootUrl).origin;
    if (contextOrigin !== rootOrigin) {
      throw new Error("Authenticated crawl context must match the target's exact origin.");
    }

    const rootUrl = new URL("/", rootOrigin);
    const queue: QueuedUrl[] = [{ url: rootUrl, depth: 0, source: "seed" }];
    const queued = new Set([rootUrl.toString()]);
    const visited = new Set<string>();
    const entries = new Set<string>();
    const cookieJar = new TemporaryCookieJar(input.context.cookies);
    let pagesFetched = 0;
    let authenticationSignals = 0;

    this.repository.markAuthenticatedCrawlRunning(input.sessionId, input.targetId);

    try {
      while (queue.length > 0 && visited.size < limits.maxPages) {
        const next = queue.shift();
        if (!next || next.depth > limits.maxDepth || visited.has(next.url.toString())) {
          continue;
        }
        visited.add(next.url.toString());
        const fetched = await this.fetchSameOrigin(
          next.url,
          contextOrigin,
          input.context.headers,
          cookieJar,
          limits.requestTimeoutMs,
        );
        const { response, url } = fetched;
        cookieJar.accept(response);
        const record = this.repository.upsertEntry({
          targetId: input.targetId,
          normalizedUrl: url.toString(),
          path: `${url.pathname}${url.search}`,
          method: "GET",
          httpStatus: null,
          source: next.source,
          provenance: "authenticated",
          depth: next.depth,
        });
        entries.add(`GET ${url.toString()}`);
        this.repository.upsertAccessObservation({
          sessionId: input.sessionId,
          targetId: input.targetId,
          entryId: record.id,
          httpStatus: response.status,
        });

        const body = isHtml(response)
          ? await readResponseText(response, limits.maxResponseBytes)
          : "";
        const hasAuthenticationSignal = isAuthenticationSignal(
          response,
          url,
          body,
          fetched.crossOriginRedirectUrl,
        );
        authenticationSignals = hasAuthenticationSignal
          ? authenticationSignals + 1
          : 0;
        if (
          hasAuthenticationSignal &&
          authenticationSignals < authenticationSignalThreshold
        ) {
          const confirmation = await this.fetchSameOrigin(
            url,
            contextOrigin,
            input.context.headers,
            cookieJar,
            limits.requestTimeoutMs,
            "HEAD",
          );
          cookieJar.accept(confirmation.response);
          if (
            isAuthenticationSignal(
              confirmation.response,
              confirmation.url,
              "",
              confirmation.crossOriginRedirectUrl,
            )
          ) {
            authenticationSignals += 1;
          }
        }
        if (authenticationSignals >= authenticationSignalThreshold) {
          const errorMessage =
            "Repeated authentication-required responses paused the authenticated crawl.";
          this.repository.markAuthenticatedCrawlAuthenticationRequired(
            input.sessionId,
            input.targetId,
            errorMessage,
          );
          return {
            status: "authentication_required",
            pagesFetched,
            entriesDiscovered: entries.size,
            errorMessage,
          };
        }

        if (!response.ok || !isHtml(response)) {
          continue;
        }
        pagesFetched += 1;
        const $ = load(body);
        $('a[href]').each((_, element) => {
          this.enqueue(
            $(element).attr("href"),
            url,
            contextOrigin,
            next.depth + 1,
            "html_link",
            limits.maxDepth,
            queue,
            queued,
          );
        });
      }

      this.repository.markAuthenticatedCrawlCompleted(input.sessionId, input.targetId);
      return {
        status: "completed",
        pagesFetched,
        entriesDiscovered: entries.size,
      };
    } catch (error) {
      const errorMessage = toErrorMessage(error);
      this.repository.markAuthenticatedCrawlFailed(
        input.sessionId,
        input.targetId,
        errorMessage,
      );
      return {
        status: "failed",
        pagesFetched,
        entriesDiscovered: entries.size,
        errorMessage,
      };
    } finally {
      cookieJar.clear();
    }
  }

  private enqueue(
    value: string | undefined,
    baseUrl: URL,
    origin: string,
    depth: number,
    source: QueuedUrl["source"],
    maxDepth: number,
    queue: QueuedUrl[],
    queued: Set<string>,
  ) {
    const url = createAbsoluteCrawlUrl(value, baseUrl);
    if (!url || url.origin !== origin || depth > maxDepth || queued.has(url.toString())) {
      return;
    }
    queued.add(url.toString());
    queue.push({ url, depth, source });
  }

  private async fetchSameOrigin(
    initialUrl: URL,
    origin: string,
    contextHeaders: string,
    cookieJar: TemporaryCookieJar,
    timeoutMs: number,
    method: "GET" | "HEAD" = "GET",
  ) {
    let url = initialUrl;
    for (let redirects = 0; redirects < 10; redirects += 1) {
      const headers = new Headers({
        accept: "text/html,application/xhtml+xml,*/*;q=0.8",
      });
      parseHeaderLines(contextHeaders).forEach((line) => {
        const separator = line.indexOf(":");
        if (separator > 0) {
          headers.set(line.slice(0, separator).trim(), line.slice(separator + 1).trim());
        }
      });
      const cookies = cookieJar.getHeader();
      if (cookies) {
        headers.set("cookie", cookies);
      }
      const response = await this.fetch(url.toString(), {
        method,
        headers,
        redirect: "manual",
        signal: AbortSignal.timeout(timeoutMs),
      });
      const location = response.headers.get("location");
      if (response.status < 300 || response.status >= 400 || !location) {
        return { response, url, crossOriginRedirectUrl: null };
      }
      const nextUrl = createAbsoluteCrawlUrl(location, url);
      if (!nextUrl || nextUrl.origin !== origin) {
        return { response, url, crossOriginRedirectUrl: nextUrl };
      }
      cookieJar.accept(response);
      url = nextUrl;
    }
    throw new Error("Authenticated crawl redirect limit exceeded.");
  }
}

export const authenticatedSitemapCrawler = new AuthenticatedSitemapCrawler();
