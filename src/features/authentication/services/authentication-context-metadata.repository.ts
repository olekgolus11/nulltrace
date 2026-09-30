import { Database } from "bun:sqlite";
import {
  AuthCheckMetadata,
  AuthenticatedRequestContextMetadata,
} from "../model/authenticated-request-context.types";
import { sessionDatabase } from "../../session/services/session-database";
import { AuthenticationContextMetadataRow } from "../model/authentication-context-metadata.types";
import { AuthenticationContextStateRepository } from "./authentication-context-state.repository";
import { mapAuthenticationContextMetadataRow } from "./authentication-context-metadata.helpers";
import { getAuthenticationRuntimeId } from "./authentication-runtime";

export class AuthenticationContextMetadataRepository {
  constructor(
    private readonly database: Database = sessionDatabase,
    private readonly runtimeId: string = getAuthenticationRuntimeId(),
  ) {}

  createContextStateRepository() {
    return new AuthenticationContextStateRepository(this.database);
  }

  findBySessionId(
    sessionId: string,
    expectedContextGeneration?: number,
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
          auth_check_json AS authCheckJson,
          local_storage_entry_count AS localStorageEntryCount,
          session_storage_entry_count AS sessionStorageEntryCount,
          context_generation AS contextGeneration
        FROM session_authentication_context_metadata
        WHERE session_id = ?1 AND runtime_id = ?2
          AND (
            (context_generation IS NULL AND NOT EXISTS (
              SELECT 1 FROM session_authentication_context_state WHERE session_id = ?1
            ))
            OR EXISTS (
              SELECT 1 FROM session_authentication_context_state AS context_state
              WHERE context_state.session_id = ?1
                AND context_state.status = 'active'
                AND context_state.generation = session_authentication_context_metadata.context_generation
                AND context_state.storage_mode = session_authentication_context_metadata.storage_mode
            )
          )`,
      )
      .get(sessionId, this.runtimeId);
    if (!row || (expectedContextGeneration !== undefined && row.contextGeneration !== expectedContextGeneration)) {
      return null;
    }
    return mapAuthenticationContextMetadataRow(row);
  }

  upsert(
    sessionId: string,
    metadata: AuthenticatedRequestContextMetadata,
    contextGeneration: number | null = null,
  ) {
    this.database
      .query(
        `INSERT INTO session_authentication_context_metadata (
          session_id, runtime_id, origin, cookie_count, header_names_json,
          storage_mode, import_source, updated_at, auth_check_json,
          local_storage_entry_count, session_storage_entry_count, context_generation
        ) SELECT ?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12
        WHERE (
          (?12 IS NOT NULL AND EXISTS (
            SELECT 1 FROM session_authentication_context_state
            WHERE session_id = ?1 AND generation = ?12 AND status = 'active'
              AND storage_mode = ?6
          ))
          OR (?12 IS NULL AND NOT EXISTS (
            SELECT 1 FROM session_authentication_context_state WHERE session_id = ?1
          ))
        )
        ON CONFLICT(session_id) DO UPDATE SET
          runtime_id = excluded.runtime_id,
          origin = excluded.origin,
          cookie_count = excluded.cookie_count,
          header_names_json = excluded.header_names_json,
          storage_mode = excluded.storage_mode,
          import_source = excluded.import_source,
          updated_at = excluded.updated_at,
          auth_check_json = excluded.auth_check_json,
          local_storage_entry_count = excluded.local_storage_entry_count,
          session_storage_entry_count = excluded.session_storage_entry_count,
          context_generation = excluded.context_generation
        WHERE (
          (excluded.context_generation IS NOT NULL AND EXISTS (
            SELECT 1 FROM session_authentication_context_state
            WHERE session_id = excluded.session_id
              AND generation = excluded.context_generation AND status = 'active'
              AND storage_mode = excluded.storage_mode
          ))
          OR (excluded.context_generation IS NULL AND NOT EXISTS (
            SELECT 1 FROM session_authentication_context_state
            WHERE session_id = excluded.session_id
          ))
        )`,
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
        metadata.browserStorage?.localStorageEntryCount ?? 0,
        metadata.browserStorage?.sessionStorageEntryCount ?? 0,
        contextGeneration,
      );
    return this.findBySessionId(sessionId, contextGeneration ?? undefined);
  }

  updateAuthCheck(sessionId: string, authCheck: AuthCheckMetadata) {
    const generation = this.database
      .query<{ contextGeneration: number | null }, [string, string]>(
        `SELECT context_generation AS contextGeneration
         FROM session_authentication_context_metadata
         WHERE session_id = ?1 AND runtime_id = ?2`,
      )
      .get(sessionId, this.runtimeId)?.contextGeneration;
    if (generation === undefined || generation === null) {
      return null;
    }
    return this.updateAuthCheckForGeneration(sessionId, authCheck, generation)
      ? this.findBySessionId(sessionId, generation)
      : null;
  }

  updateAuthCheckForGeneration(
    sessionId: string,
    authCheck: AuthCheckMetadata,
    generation: number,
  ) {
    const result = this.database
      .query(
        `UPDATE session_authentication_context_metadata
         SET auth_check_json = ?3
         WHERE session_id = ?1 AND runtime_id = ?2 AND context_generation = ?4
           AND EXISTS (
             SELECT 1 FROM session_authentication_context_state
             WHERE session_id = ?1 AND generation = ?4 AND status = 'active'
               AND storage_mode = (
                 SELECT metadata.storage_mode FROM session_authentication_context_metadata AS metadata
                 WHERE metadata.session_id = ?1 AND metadata.runtime_id = ?2
               )
           )`,
      )
      .run(sessionId, this.runtimeId, JSON.stringify(authCheck), generation);
    return result.changes === 1;
  }

  clearForGeneration(sessionId: string, generation: number) {
    this.database
      .query(
        `DELETE FROM session_authentication_context_metadata
         WHERE session_id = ?1 AND runtime_id = ?2
           AND (context_generation IS NULL OR context_generation < ?3)`,
      )
      .run(sessionId, this.runtimeId, generation);
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
