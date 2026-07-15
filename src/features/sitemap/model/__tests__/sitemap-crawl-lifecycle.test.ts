import { describe, expect, it } from "bun:test";
import {
  getCrawlLifecycleActionState,
  getSitemapCrawlControlPresentation,
  selectTransientCrawlFailures,
} from "../sitemap-crawl-lifecycle";
import { SitemapCrawlFailure } from "../sitemap.types";

const failures: SitemapCrawlFailure[] = [
  {
    url: "https://example.com/timeout",
    depth: 1,
    source: "html_link",
    kind: "timeout",
    httpStatus: null,
    errorMessage: "Request timed out",
  },
  {
    url: "https://example.com/rate-limited",
    depth: 1,
    source: "html_link",
    kind: "http",
    httpStatus: 429,
    errorMessage: "HTTP 429",
  },
  {
    url: "https://example.com/server-error",
    depth: 1,
    source: "html_link",
    kind: "http",
    httpStatus: 503,
    errorMessage: "HTTP 503",
  },
  {
    url: "https://example.com/not-found",
    depth: 1,
    source: "html_link",
    kind: "http",
    httpStatus: 404,
    errorMessage: "HTTP 404",
  },
  {
    url: "https://example.com/network",
    depth: 1,
    source: "html_link",
    kind: "network",
    httpStatus: null,
    errorMessage: "Connection refused",
  },
  {
    url: "https://example.com/nonstandard-status",
    depth: 1,
    source: "html_link",
    kind: "http",
    httpStatus: 600,
    errorMessage: "HTTP 600",
  },
];

describe("sitemap crawl lifecycle", () => {
  it("only selects timeout, 429, and 5xx failures for retry", () => {
    expect(
      selectTransientCrawlFailures(failures).map((failure) => failure.url),
    ).toEqual([
      "https://example.com/timeout",
      "https://example.com/rate-limited",
      "https://example.com/server-error",
    ]);
  });

  it("offers pause while running and resume while paused", () => {
    expect(getCrawlLifecycleActionState("running", 0, false)).toEqual({
      canPause: true,
      canResume: false,
      canRetryFailures: false,
      canRestart: true,
      requiresAuthCheck: false,
    });
    expect(getCrawlLifecycleActionState("paused", 2, false)).toEqual({
      canPause: false,
      canResume: true,
      canRetryFailures: true,
      canRestart: true,
      requiresAuthCheck: false,
    });
  });

  it("keeps ordinary resume unavailable when authentication is required", () => {
    expect(
      getCrawlLifecycleActionState("authentication_required", 2, true),
    ).toEqual({
      canPause: false,
      canResume: false,
      canRetryFailures: false,
      canRestart: false,
      requiresAuthCheck: true,
    });
  });

  it("keeps public and authenticated controls visibly scoped", () => {
    expect(
      getSitemapCrawlControlPresentation("public", "paused", "idle", 1, 0),
    ).toMatchObject({
      scope: "public",
      status: "paused",
      hint: "Public · Space resume · r retry failures · R restart",
    });
    expect(
      getSitemapCrawlControlPresentation(
        "authenticated",
        "completed",
        "authentication_required",
        0,
        1,
      ),
    ).toMatchObject({
      scope: "authenticated",
      status: "authentication_required",
      hint: "Authenticated locked · lifecycle keys open auth renewal",
    });
    expect(
      getSitemapCrawlControlPresentation("all", "running", "paused", 0, 0),
    ).toMatchObject({
      scope: "public",
      status: "running",
      hint: "Public · Space pause · R restart",
    });
  });
});
