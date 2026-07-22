import { theme } from "../../../app/theme/theme";
import {
  AuthCheckMetadata,
  AuthenticatedRequestContextMetadata,
} from "../model/authenticated-request-context.types";
import { getAuthenticationPosture } from "../model/authentication-posture";

export interface AuthCheckPresentation {
  headerLabel: string;
  modalLabel: string;
  color: string;
}

export function getAuthCheckPresentation(authCheck: AuthCheckMetadata): AuthCheckPresentation {
  switch (authCheck.status) {
    case "verified":
      return {
        headerLabel: "verified",
        modalLabel: "VERIFIED",
        color: theme.accent.primary,
      };
    case "inconclusive":
      return authCheck.isProceedAllowed
        ? {
            headerLabel: "inconclusive (acknowledged)",
            modalLabel: "INCONCLUSIVE / ACKNOWLEDGED",
            color: theme.accent.warning,
          }
        : {
            headerLabel: "inconclusive (blocked)",
            modalLabel: "INCONCLUSIVE / BLOCKED",
            color: theme.accent.warning,
          };
    case "failed":
      return {
        headerLabel: "check failed",
        modalLabel: "FAILED",
        color: theme.accent.critical,
      };
    case "not_checked":
      return {
        headerLabel: "awaiting check",
        modalLabel: "NOT CHECKED",
        color: theme.text.muted,
      };
  }
}

export function getAuthenticationHeaderPresentation(
  metadata: AuthenticatedRequestContextMetadata | null,
  isAuthenticationRequired: boolean,
): AuthCheckPresentation | null {
  const posture = getAuthenticationPosture(metadata, isAuthenticationRequired);
  if (posture === "absent") {
    return null;
  }
  if (posture === "authentication_required") {
    return {
      headerLabel: "authentication required",
      modalLabel: "AUTHENTICATION REQUIRED",
      color: theme.accent.critical,
    };
  }
  return metadata ? getAuthCheckPresentation(metadata.authCheck) : null;
}
