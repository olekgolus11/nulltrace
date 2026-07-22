import type { AuthCheckSignalMetadata } from "../model/authenticated-request-context.types";
import type { AuthenticatedRequestContextService } from "./authenticated-request-context.service";
import type { AuthenticationContextMetadataRepository } from "./authentication-context-metadata.repository";

type FetchFunction = (input: string, init?: RequestInit) => Promise<Response>;

export interface AuthCheckResponseSignals {
  status: number;
  redirects: string[];
  contentType: string;
  contentFingerprint: string;
  title: string | null;
  hasLoginForm: boolean;
}

export interface AuthCheckResponsePair {
  unauthenticated: AuthCheckResponseSignals;
  authenticated: AuthCheckResponseSignals;
}

export interface AuthCheckComparisonResult {
  status: "verified" | "inconclusive" | "failed";
  isProceedAllowed: boolean;
  summary: string;
  signals: AuthCheckSignalMetadata;
}

export interface AuthCheckServiceOptions {
  contextService?: AuthenticatedRequestContextService;
  metadataRepository?: AuthenticationContextMetadataRepository;
  fetch?: FetchFunction;
  requestTimeoutMs?: number;
  maxResponseBytes?: number;
  maxRedirects?: number;
}

export type AuthenticatedContextVerificationResult = "valid" | "invalid" | "inconclusive";

export interface AuthenticatedContextVerificationInput {
  sessionId: string;
  targetUrl: string;
  cookies: string;
  headers: string;
}

export interface AuthenticatedContextVerifier {
  verify(
    input: AuthenticatedContextVerificationInput,
  ): Promise<AuthenticatedContextVerificationResult>;
}
