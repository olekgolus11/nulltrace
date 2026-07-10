export type AuthenticatedContextStorageMode = "secure" | "memory";

export interface AuthenticatedRequestContextInput {
  origin: string;
  cookies: string;
  headers: string;
}

export interface AuthenticatedRequestContext {
  origin: string;
  cookies: string;
  headers: string;
  updatedAt: string;
}

export interface AuthenticatedRequestContextMetadata {
  origin: string;
  cookieCount: number;
  headerNames: string[];
  storageMode: AuthenticatedContextStorageMode;
  updatedAt: string;
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
