import { AuthCheckMetadata } from "../model/authenticated-request-context.types";
import { AuthCheckComparisonResult } from "./auth-check.types";

export function createAuthCheckVerificationMetadata(
  current: AuthCheckMetadata,
  comparison: AuthCheckComparisonResult,
  verificationUrl: string,
  checkedAt: string,
): AuthCheckMetadata {
  const preserveAcknowledgement =
    comparison.status === "inconclusive" &&
    current.status === "inconclusive" &&
    current.isProceedAllowed &&
    current.acknowledgedAt !== null;

  return {
    ...comparison,
    verificationUrl,
    checkedAt,
    acknowledgedAt: preserveAcknowledgement ? current.acknowledgedAt : null,
    isProceedAllowed: preserveAcknowledgement ? true : comparison.isProceedAllowed,
    summary: preserveAcknowledgement ? current.summary : comparison.summary,
  };
}
