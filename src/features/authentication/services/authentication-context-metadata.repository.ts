import { Database } from "bun:sqlite";
import {
  AuthCheckMetadata,
  AuthCheckSignalMetadata,
  AuthCheckStatus,
  AuthenticatedContextImportSource,
  AuthenticatedContextStorageMode,
  AuthenticatedRequestContextMetadata,
} from "../model/authenticated-request-context.types";
import { sessionDatabase } from "../../session/services/session-database";
import { getAuthenticationRuntimeId } from "./authentication-runtime";

interface AuthenticationContextMetadataRow {
  sessionId: string;
  origin: string;
  cookieCount: number;
  headerNamesJson: string;
  storageMode: string;
  importSource: string;
  updatedAt: string;
  authCheckJson: string;
}

const authCheckStatuses = [
  "not_checked",
  "verified",
  "inconclusive",
  "failed",
] as const;

function isNullableString(value: unknown): value is string | null {
  return value === null || typeof value === "string";
}

function isAuthCheckSignals(
  value: unknown,
): value is AuthCheckSignalMetadata | null {
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
    return Array.isArray(parsed) && parsed.every((name) => typeof name === "string")
      ? parsed
      : [];
  } catch {
    return [];
  }
}

function normalizeStorageMode(
  value: string,
): AuthenticatedContextStorageMode | null {
  return value === "memory" || value === "secure" ? value : null;
}

function normalizeImportSource(
  value: string,
): AuthenticatedContextImportSource | null {
  return value === "manual" || value === "curl" || value === "har"
    ? value
    : null;
}

function mapMetadataRow(
  row: AuthenticationContextMetadataRow,
): AuthenticatedRequestContextMetadata | null {
  const authCheck = parseAuthCheckMetadata(row.authCheckJson);
  const storageMode = normalizeStorageMode(row.storageMode);
  const importSource = normalizeImportSource(row.importSource);
  if (
    !authCheck ||
    !storageMode ||
    !importSource ||
    row.cookieCount < 0
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
  };
}

export class AuthenticationContextMetadataRepository {
  constructor(
    private readonly database: Database = sessionDatabase,
    private readonly runtimeId: string = getAuthenticationRuntimeId(),
  ) {}

  findBySessionId(
    sessionId: string,
  ): AuthenticatedRequestContextMetadata | null {
    const row = this.database
      .query<AuthenticationContextMetadataRow, [string, string]>(
        `SELECT
          session_id AS sessionId,
          origin,
          cookie_count AS cookieCount,
          header_names_json AS headerNamesJson,
          storage_mode AS storageMode,
          import_source AS importSource,
          updated_at AS updatedAt,
          auth_check_json AS authCheckJson
        FROM session_authentication_context_metadata
        WHERE session_id = ?1 AND runtime_id = ?2`,
      )
      .get(sessionId, this.runtimeId);
    return row ? mapMetadataRow(row) : null;
  }

  upsert(sessionId: string, metadata: AuthenticatedRequestContextMetadata) {
    this.database
      .query(
        `INSERT INTO session_authentication_context_metadata (
          session_id, runtime_id, origin, cookie_count, header_names_json,
          storage_mode, import_source, updated_at, auth_check_json
        ) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9)
        ON CONFLICT(session_id) DO UPDATE SET
          runtime_id = excluded.runtime_id,
          origin = excluded.origin,
          cookie_count = excluded.cookie_count,
          header_names_json = excluded.header_names_json,
          storage_mode = excluded.storage_mode,
          import_source = excluded.import_source,
          updated_at = excluded.updated_at,
          auth_check_json = excluded.auth_check_json`,
      )
      .run(
        sessionId,
        this.runtimeId,
        metadata.origin,
        metadata.cookieCount,
        JSON.stringify(metadata.headerNames),
        metadata.storageMode,
        metadata.importSource,
        metadata.updatedAt,
        JSON.stringify(metadata.authCheck),
      );
    return metadata;
  }

  updateAuthCheck(sessionId: string, authCheck: AuthCheckMetadata) {
    const metadata = this.findBySessionId(sessionId);
    return metadata
      ? this.upsert(sessionId, { ...metadata, authCheck })
      : null;
  }

  clear(sessionId: string) {
    this.database
      .query(
        `DELETE FROM session_authentication_context_metadata
         WHERE session_id = ?1 AND runtime_id = ?2`,
      )
      .run(sessionId, this.runtimeId);
  }
}

export const authenticationContextMetadataRepository =
  new AuthenticationContextMetadataRepository();
