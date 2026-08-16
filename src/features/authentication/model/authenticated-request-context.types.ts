export type AuthenticatedContextStorageMode = "secure" | "memory";

export type AuthenticatedContextImportSource = "manual" | "curl" | "har";

export type AuthCheckStatus = "not_checked" | "verified" | "inconclusive" | "failed";

export interface AuthCheckSignalMetadata {
  unauthenticatedStatus: number;
  authenticatedStatus: number;
  unauthenticatedRedirectCount: number;
  authenticatedRedirectCount: number;
  unauthenticatedContentType: string;
  authenticatedContentType: string;
  unauthenticatedHasLoginForm: boolean;
  authenticatedHasLoginForm: boolean;
  hasStatusChanged: boolean;
  hasRedirectsChanged: boolean;
  hasContentTypeChanged: boolean;
  hasContentFingerprintChanged: boolean;
  hasTitleChanged: boolean;
  hasLoginFormChanged: boolean;
}

export interface AuthCheckMetadata {
  status: AuthCheckStatus;
  verificationUrl: string | null;
  checkedAt: string | null;
  acknowledgedAt: string | null;
  isProceedAllowed: boolean;
  summary: string;
  signals: AuthCheckSignalMetadata | null;
}

export interface AuthenticatedRequestContextInput {
  origin: string;
  cookies: string;
  headers: string;
  importSource?: AuthenticatedContextImportSource;
  browserStorage?: AuthenticatedRequestBrowserStorage;
}

export interface AuthenticatedRequestContext {
  origin: string;
  cookies: string;
  headers: string;
  importSource?: AuthenticatedContextImportSource;
  updatedAt: string;
  browserStorage?: AuthenticatedRequestBrowserStorage;
}

export type AuthenticatedRequestStorageEntries = Record<string, string>;

export interface AuthenticatedRequestBrowserStorage {
  localStorage: AuthenticatedRequestStorageEntries;
  sessionStorage: AuthenticatedRequestStorageEntries;
}

export interface AuthenticatedRequestBrowserStorageMetadata {
  localStorageEntryCount: number;
  sessionStorageEntryCount: number;
}

export interface AuthenticatedRequestContextMetadata {
  origin: string;
  cookieCount: number;
  headerNames: string[];
  storageMode: AuthenticatedContextStorageMode;
  importSource: AuthenticatedContextImportSource;
  updatedAt: string;
  authCheck: AuthCheckMetadata;
  browserStorage?: AuthenticatedRequestBrowserStorageMetadata;
}

export interface RedactedAuthenticatedRequestContextPreview {
  origin: string;
  cookieCount: number;
  headerNames: string[];
  cookiePreview: string;
  headerPreview: string[];
}

export type AuthenticatedContextInvalidationReason = "replaced" | "cleared";

export interface AuthenticatedContextInvalidation {
  sessionId: string;
  reason: AuthenticatedContextInvalidationReason;
  version: number;
}
