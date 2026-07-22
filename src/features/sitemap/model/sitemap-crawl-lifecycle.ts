import {
  AuthenticatedSitemapCrawlStatus,
  SitemapCrawlFailure,
  TargetSitemapCrawlStatus,
  TargetSitemapProvenanceFilter,
} from "./sitemap.types";

export interface SitemapCrawlLifecycleActionState {
  canPause: boolean;
  canResume: boolean;
  canRestart: boolean;
  requiresAuthCheck: boolean;
}

export interface SitemapCrawlControlPresentation {
  scope: "public" | "authenticated" | null;
  status: TargetSitemapCrawlStatus | AuthenticatedSitemapCrawlStatus | null;
  hint: string;
  actions: SitemapCrawlLifecycleActionState | null;
}

export function getCrawlLifecycleActionState(
  status: TargetSitemapCrawlStatus | AuthenticatedSitemapCrawlStatus,
  isAuthenticated: boolean,
): SitemapCrawlLifecycleActionState {
  const requiresAuthCheck = isAuthenticated && status === "authentication_required";

  return {
    canPause: status === "running",
    canResume: status === "paused",
    canRestart: !requiresAuthCheck && status !== "idle",
    requiresAuthCheck,
  };
}

export function getSitemapCrawlControlPresentation(
  provenance: TargetSitemapProvenanceFilter,
  publicStatus: TargetSitemapCrawlStatus,
  authenticatedStatus: AuthenticatedSitemapCrawlStatus,
): SitemapCrawlControlPresentation {
  if (provenance === "all") {
    return {
      scope: null,
      status: null,
      hint: "Select provenance for actions",
      actions: null,
    };
  }
  const isAuthenticated = provenance === "authenticated";
  const scope = isAuthenticated ? "authenticated" : "public";
  const scopeLabel = isAuthenticated ? "Authenticated" : "Public";
  const status = isAuthenticated ? authenticatedStatus : publicStatus;
  const actions = getCrawlLifecycleActionState(status, isAuthenticated);
  if (actions.requiresAuthCheck) {
    return {
      scope,
      status,
      hint: `${scopeLabel} locked · Ctrl+R opens auth renewal`,
      actions,
    };
  }
  const hints: string[] = [];
  if (actions.canPause) {
    hints.push("Space pause");
  } else if (actions.canResume) {
    hints.push("Space resume");
  }
  if (actions.canRestart) {
    hints.push("Ctrl+R restart");
  }
  return {
    scope,
    status,
    hint: `${hints.join(" · ") || "Select provenance for actions"}`,
    actions,
  };
}
