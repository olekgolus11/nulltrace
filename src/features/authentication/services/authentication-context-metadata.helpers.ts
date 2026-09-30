import {
  AuthCheckMetadata,
  AuthCheckSignalMetadata,
  AuthCheckStatus,
  AuthenticatedContextImportSource,
  AuthenticatedContextStorageMode,
  AuthenticatedRequestContextMetadata,
} from "../model/authenticated-request-context.types";
import { AuthenticationContextMetadataRow } from "../model/authentication-context-metadata.types";

const authCheckStatuses = ["not_checked", "verified", "inconclusive", "failed"] as const;

function isNullableString(value: unknown): value is string | null {
  return value === null || typeof value === "string";
}

function isAuthCheckSignals(value: unknown): value is AuthCheckSignalMetadata | null {
  if (value === null) {
    return true;
  }
  if (!value || typeof value !== "object") {
    return false;
  }
  const signals = value as Record<string, unknown>;
  return (
    typeof signals.unauthenticatedStatus === "number" &&
    typeof signals.authenticatedStatus === "number" &&
    typeof signals.unauthenticatedRedirectCount === "number" &&
    typeof signals.authenticatedRedirectCount === "number" &&
    typeof signals.unauthenticatedContentType === "string" &&
    typeof signals.authenticatedContentType === "string" &&
    typeof signals.unauthenticatedHasLoginForm === "boolean" &&
    typeof signals.authenticatedHasLoginForm === "boolean" &&
    typeof signals.hasStatusChanged === "boolean" &&
    typeof signals.hasRedirectsChanged === "boolean" &&
    typeof signals.hasContentTypeChanged === "boolean" &&
    typeof signals.hasContentFingerprintChanged === "boolean" &&
    typeof signals.hasTitleChanged === "boolean" &&
    typeof signals.hasLoginFormChanged === "boolean"
  );
}

function parseAuthCheckMetadata(value: string): AuthCheckMetadata | null {
  try {
    const parsed: unknown = JSON.parse(value);
    if (!parsed || typeof parsed !== "object") {
      return null;
    }
    const authCheck = parsed as Record<string, unknown>;
    if (
      typeof authCheck.status !== "string" ||
      !authCheckStatuses.includes(authCheck.status as AuthCheckStatus) ||
      !isNullableString(authCheck.verificationUrl) ||
      !isNullableString(authCheck.checkedAt) ||
      !isNullableString(authCheck.acknowledgedAt) ||
      typeof authCheck.isProceedAllowed !== "boolean" ||
      typeof authCheck.summary !== "string" ||
      !isAuthCheckSignals(authCheck.signals)
    ) {
      return null;
    }
    return {
      status: authCheck.status as AuthCheckStatus,
      verificationUrl: authCheck.verificationUrl,
      checkedAt: authCheck.checkedAt,
      acknowledgedAt: authCheck.acknowledgedAt,
      isProceedAllowed: authCheck.isProceedAllowed,
      summary: authCheck.summary,
      signals: authCheck.signals,
    };
  } catch {
    return null;
  }
}

function parseHeaderNames(value: string) {
  try {
    const parsed: unknown = JSON.parse(value);
    return Array.isArray(parsed) && parsed.every((name) => typeof name === "string") ? parsed : [];
  } catch {
    return [];
  }
}

function normalizeStorageMode(value: string): AuthenticatedContextStorageMode | null {
  return value === "memory" || value === "secure" ? value : null;
}

function normalizeImportSource(value: string): AuthenticatedContextImportSource | null {
  return value === "manual" || value === "curl" || value === "har" ? value : null;
}

export function mapAuthenticationContextMetadataRow(
  row: AuthenticationContextMetadataRow,
): AuthenticatedRequestContextMetadata | null {
  const authCheck = parseAuthCheckMetadata(row.authCheckJson);
  const storageMode = normalizeStorageMode(row.storageMode);
  const importSource = normalizeImportSource(row.importSource);
  if (
    !authCheck ||
    !storageMode ||
    !importSource ||
    row.cookieCount < 0 ||
    row.localStorageEntryCount < 0 ||
    row.sessionStorageEntryCount < 0
  ) {
    return null;
  }
  return {
    origin: row.origin,
    cookieCount: row.cookieCount,
    headerNames: parseHeaderNames(row.headerNamesJson),
    storageMode,
    importSource,
    updatedAt: row.updatedAt,
    authCheck,
    ...(row.localStorageEntryCount > 0 || row.sessionStorageEntryCount > 0
      ? {
          browserStorage: {
            localStorageEntryCount: row.localStorageEntryCount,
            sessionStorageEntryCount: row.sessionStorageEntryCount,
          },
        }
      : {}),
  };
}
