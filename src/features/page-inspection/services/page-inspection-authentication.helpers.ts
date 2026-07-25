import { PageInspectionSnapshot } from "../model/page-inspection.types";

export function isRejectedPageInspectionAuthentication(snapshot: PageInspectionSnapshot) {
  if (snapshot.status === 401 || snapshot.status === 403) {
    return true;
  }
  return /(?:^|\/)(?:login|log-in|signin|sign-in|sso|oauth|authorize)(?:\.[a-z0-9]+)?(?:\/|$)/i.test(
    new URL(snapshot.finalUrl).pathname,
  );
}
