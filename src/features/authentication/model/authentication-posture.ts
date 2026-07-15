import { AuthenticatedRequestContextMetadata } from "./authenticated-request-context.types";

export type AuthenticationPosture =
  | "absent"
  | "awaiting_verification"
  | "verified"
  | "acknowledged_inconclusive"
  | "requires_action"
  | "authentication_required";

export function getAuthenticationPosture(
  metadata: AuthenticatedRequestContextMetadata | null,
  isAuthenticationRequired: boolean,
): AuthenticationPosture {
  if (!metadata) {
    return "absent";
  }
  if (isAuthenticationRequired) {
    return "authentication_required";
  }
  if (metadata.authCheck.status === "verified") {
    return "verified";
  }
  if (
    metadata.authCheck.status === "inconclusive" &&
    metadata.authCheck.isProceedAllowed
  ) {
    return "acknowledged_inconclusive";
  }
  if (metadata.authCheck.status === "not_checked") {
    return "awaiting_verification";
  }
  return "requires_action";
}
