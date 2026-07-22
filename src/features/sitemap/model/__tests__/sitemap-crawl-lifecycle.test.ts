import { describe, expect, it } from "bun:test";
import {
  getCrawlLifecycleActionState,
  getSitemapCrawlControlPresentation,
} from "../sitemap-crawl-lifecycle";

describe("sitemap crawl lifecycle", () => {
  it("offers pause while running and resume while paused", () => {
    expect(getCrawlLifecycleActionState("running", false)).toEqual({
      canPause: true,
      canResume: false,
      canRestart: true,
      requiresAuthCheck: false,
    });
    expect(getCrawlLifecycleActionState("paused", false)).toEqual({
      canPause: false,
      canResume: true,
      canRestart: true,
      requiresAuthCheck: false,
    });
  });

  it("keeps ordinary resume unavailable when authentication is required", () => {
    expect(getCrawlLifecycleActionState("authentication_required", true)).toEqual({
      canPause: false,
      canResume: false,
      canRestart: false,
      requiresAuthCheck: true,
    });
  });

  it("keeps public and authenticated controls visibly scoped", () => {
    expect(getSitemapCrawlControlPresentation("public", "paused", "idle")).toMatchObject({
      scope: "public",
      status: "paused",
      hint: "Space resume · Ctrl+R restart",
    });
    expect(
      getSitemapCrawlControlPresentation("authenticated", "completed", "authentication_required"),
    ).toMatchObject({
      scope: "authenticated",
      status: "authentication_required",
      hint: "Authenticated locked · Ctrl+R opens auth renewal",
    });
    expect(getSitemapCrawlControlPresentation("public", "running", "paused")).toMatchObject({
      scope: "public",
      status: "running",
      hint: "Space pause · Ctrl+R restart",
    });
  });

  it("hides manual controls for all provenance", () => {
    expect(getSitemapCrawlControlPresentation("all", "running", "paused")).toEqual({
      scope: null,
      status: null,
      hint: "Select provenance for actions",
      actions: null,
    });
  });
});
