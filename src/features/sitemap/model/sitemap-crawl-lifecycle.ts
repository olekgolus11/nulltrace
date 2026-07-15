import {
  AuthenticatedSitemapCrawlStatus,
  SitemapCrawlFailure,
  TargetSitemapCrawlStatus,
  TargetSitemapProvenanceFilter,
} from "./sitemap.types";

export interface SitemapCrawlLifecycleActionState {
  canPause: boolean;
  canResume: boolean;
  canRetryFailures: boolean;
  canRestart: boolean;
  requiresAuthCheck: boolean;
}

export interface SitemapCrawlControlPresentation {
  scope: "public" | "authenticated" | null;
  status: TargetSitemapCrawlStatus | AuthenticatedSitemapCrawlStatus | null;
  hint: string;
  actions: SitemapCrawlLifecycleActionState | null;
}

export function isTransientCrawlFailure(failure: SitemapCrawlFailure) {
  return failure.kind === "timeout" ||
    (failure.kind === "http" &&
      (failure.httpStatus === 429 ||
        ((failure.httpStatus ?? 0) >= 500 &&
          (failure.httpStatus ?? 0) <= 599)));
}

export function selectTransientCrawlFailures(
  failures: SitemapCrawlFailure[],
) {
  return failures.filter(isTransientCrawlFailure);
}

export function getCrawlLifecycleActionState(
  status: TargetSitemapCrawlStatus | AuthenticatedSitemapCrawlStatus,
  transientFailureCount: number,
  isAuthenticated: boolean,
): SitemapCrawlLifecycleActionState {
  const requiresAuthCheck =
    isAuthenticated && status === "authentication_required";

  return {
    canPause: status === "running",
    canResume: status === "paused",
    canRetryFailures:
      !requiresAuthCheck && status !== "running" && transientFailureCount > 0,
    canRestart:
      !requiresAuthCheck && status !== "idle",
    requiresAuthCheck,
  };
}

export function getSitemapCrawlControlPresentation(
  provenance: TargetSitemapProvenanceFilter,
  publicStatus: TargetSitemapCrawlStatus,
  authenticatedStatus: AuthenticatedSitemapCrawlStatus,
  publicTransientFailureCount: number,
  authenticatedTransientFailureCount: number,
): SitemapCrawlControlPresentation {
  const isAuthenticated = provenance === "authenticated";
  const scope = isAuthenticated ? "authenticated" : "public";
  const scopeLabel = isAuthenticated ? "Authenticated" : "Public";
  const status = isAuthenticated ? authenticatedStatus : publicStatus;
  const actions = getCrawlLifecycleActionState(
    status,
    isAuthenticated
      ? authenticatedTransientFailureCount
      : publicTransientFailureCount,
    isAuthenticated,
  );
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
    hint: `${scopeLabel} · ${hints.join(" · ") || "No lifecycle actions available"}`,
    actions,
  };
}
