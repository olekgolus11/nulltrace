export interface AuthCheckWorkerConfiguration {
  version: 1;
  operation: "auth-check";
  contextVersion: number;
  targetOrigin: string;
  verificationUrl: string;
  authenticatedHeaders: string[];
  requestTimeoutMs: 10_000;
  maximumResponseBytes: 128_000;
  maximumRedirectCount: 5;
  totalDeadlineMs: number;
}

export type AuthCheckWorkerContentKind = "html" | "xhtml" | "json" | "other";

export interface AuthCheckWorkerLegSignals {
  status: number;
  redirectCount: number;
  hasCrossOriginRedirect: boolean;
  contentKind: AuthCheckWorkerContentKind;
  hasLoginForm: boolean;
}

export interface AuthCheckWorkerResult {
  version: 1;
  operation: "auth-check";
  status: "verified" | "inconclusive" | "failed";
  isProceedAllowed: boolean;
  unauthenticated: AuthCheckWorkerLegSignals;
  authenticated: AuthCheckWorkerLegSignals;
  differences: {
    statusChanged: boolean;
    redirectsChanged: boolean;
    contentKindChanged: boolean;
    contentChanged: boolean;
    titleChanged: boolean;
    loginFormChanged: boolean;
  };
}
