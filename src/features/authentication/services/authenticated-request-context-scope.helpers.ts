import { AuthenticatedRequestContextMetadata } from "../model/authenticated-request-context.types";
import { normalizeExactOrigin } from "./authenticated-request-context-validation.helpers";

export function isAcceptedAuthenticatedContextForTarget(
  metadata: AuthenticatedRequestContextMetadata | null | undefined,
  targetUrl: string,
) {
  if (!metadata?.authCheck.isProceedAllowed) return false;
  try {
    return metadata.origin === normalizeExactOrigin(targetUrl);
  } catch {
    return false;
  }
}
