import {
  PageInspectionAuthenticationOutcome,
  PageInspectionSnapshot,
} from "../model/page-inspection.types";

export function getPageInspectionAuthenticationOutcome(
  snapshot: PageInspectionSnapshot,
): PageInspectionAuthenticationOutcome {
  if (snapshot.status === 401) {
    return "unauthorized";
  }
  if (snapshot.status === 403) {
    return "forbidden";
  }
  const requestedPath = new URL(snapshot.requestedUrl).pathname;
  const finalPath = new URL(snapshot.finalUrl).pathname;
  const isAuthenticationPath = (path: string) =>
    /(?:^|\/)(?:login|log-in|signin|sign-in|sso|oauth|authorize)(?:\.[a-z0-9]+)?(?:\/|$)/i.test(
      path,
    );
  return !isAuthenticationPath(requestedPath) && isAuthenticationPath(finalPath)
    ? "login_redirect"
    : null;
}
