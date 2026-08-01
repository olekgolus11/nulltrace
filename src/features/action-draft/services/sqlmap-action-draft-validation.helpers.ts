import { normalizeExactOrigin } from "../../authentication/services/authenticated-request-context.service";

export function validateAuthenticatedSqlmapDraftOrigin(
  targetUrl: string,
  sessionTargetUrl: string | null,
) {
  if (
    !sessionTargetUrl ||
    normalizeExactOrigin(targetUrl) !== normalizeExactOrigin(sessionTargetUrl)
  ) {
    throw new Error(
      "Authenticated sqlmap drafts require the session target's exact origin.",
    );
  }
}
