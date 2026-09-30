import { Database } from "bun:sqlite";
import { sessionDatabase } from "../../session/services/session-database";
import {
  AuthenticationContextState,
  AuthenticationContextStateRow,
} from "../model/authentication-context-state.types";
import { parseAuthenticationContextState } from "./authentication-context-state.helpers";

export class AuthenticationContextStateRepository {
  constructor(private readonly database: Database = sessionDatabase) {}

  find(sessionId: string): AuthenticationContextState | null {
    const row = this.database
      .query<AuthenticationContextStateRow, [string]>(
        `SELECT session_id AS sessionId, generation, status, storage_mode AS storageMode
         FROM session_authentication_context_state WHERE session_id = ?1`,
      )
      .get(sessionId);
    return row ? parseAuthenticationContextState(row) : null;
  }

  beginSave(sessionId: string) {
    return this.reserveGeneration(sessionId, "saving");
  }

  activate(sessionId: string, generation: number, storageMode: AuthenticationContextState["storageMode"]) {
    if (!storageMode) {
      return false;
    }
    const activate = this.database.transaction(() => {
      const result = this.database
        .query(
          `UPDATE session_authentication_context_state
           SET status = 'active', storage_mode = ?3
           WHERE session_id = ?1 AND generation = ?2 AND status = 'saving'`,
        )
        .run(sessionId, generation, storageMode);
      if (result.changes !== 1) {
        return false;
      }
      this.database
        .query(
          `UPDATE session_authentication_context_secret_keys SET status = 'stored'
           WHERE session_id = ?1 AND generation = ?2 AND status != 'deleted'`,
        )
        .run(sessionId, generation);
      return true;
    });
    return activate();
  }

  markSecretKeyDeleted(sessionId: string, generation: number) {
    this.database
      .query(
        `UPDATE session_authentication_context_secret_keys SET status = 'deleted'
         WHERE session_id = ?1 AND generation = ?2`,
      )
      .run(sessionId, generation);
  }

  markSecretKeyPending(sessionId: string, generation: number) {
    this.database
      .query(
        `UPDATE session_authentication_context_secret_keys SET status = 'pending'
         WHERE session_id = ?1 AND generation = ?2 AND status = 'writing'`,
      )
      .run(sessionId, generation);
  }

  findSecretKeyGenerations(sessionId: string, beforeGeneration?: number) {
    const rows = this.database
      .query<{ generation: number }, [string, number | null]>(
        `SELECT generation FROM session_authentication_context_secret_keys
         WHERE session_id = ?1 AND status NOT IN ('deleted', 'writing')
           AND (?2 IS NULL OR generation < ?2)
         ORDER BY generation LIMIT 256`,
      )
      .all(sessionId, beforeGeneration ?? null);
    return rows.map((row) => row.generation);
  }

  hasUnsettledSecretWrites(sessionId: string, beforeGeneration: number) {
    return Boolean(
      this.database
        .query<{ found: number }, [string, number]>(
          `SELECT 1 AS found FROM session_authentication_context_secret_keys
           WHERE session_id = ?1 AND generation < ?2 AND status = 'writing' LIMIT 1`,
        )
        .get(sessionId, beforeGeneration),
    );
  }

  beginClear(sessionId: string) {
    return this.reserveGeneration(sessionId, "clear_pending");
  }

  confirmClear(sessionId: string, generation: number) {
    const result = this.database
      .query(
        `UPDATE session_authentication_context_state
         SET status = 'cleared', storage_mode = NULL
         WHERE session_id = ?1 AND generation = ?2 AND status = 'clear_pending'
           AND NOT EXISTS (
             SELECT 1 FROM session_authentication_context_secret_keys
             WHERE session_id = ?1 AND generation < ?2 AND status != 'deleted'
           )`,
      )
      .run(sessionId, generation);
    return result.changes === 1;
  }

  adoptLegacyContext(sessionId: string, storageMode: AuthenticationContextState["storageMode"]) {
    if (!storageMode) {
      throw new Error("Legacy authentication context has no trusted storage mode.");
    }
    this.database
      .query(
        `INSERT INTO session_authentication_context_state (
          session_id, generation, status, storage_mode
        ) VALUES (?1, 0, 'active', ?2)
        ON CONFLICT(session_id) DO NOTHING`,
      )
      .run(sessionId, storageMode);
    this.database
      .query(
        `INSERT INTO session_authentication_context_secret_keys (session_id, generation, status)
         VALUES (?1, 0, 'stored') ON CONFLICT(session_id, generation) DO NOTHING`,
      )
      .run(sessionId);
    return this.find(sessionId);
  }

  private reserveGeneration(sessionId: string, status: "saving" | "clear_pending") {
    const reserve = this.database.transaction(() => {
      const current = this.find(sessionId);
      if (current && current.generation >= Number.MAX_SAFE_INTEGER) {
        throw new Error("Authentication context generation limit reached.");
      }
      if (!current) {
        this.database
          .query(
            `INSERT INTO session_authentication_context_secret_keys (session_id, generation, status)
             VALUES (?1, 0, 'pending') ON CONFLICT(session_id, generation) DO NOTHING`,
          )
          .run(sessionId);
      }
      const row = this.database
        .query<{ generation: number }, [string]>(
          `INSERT INTO session_authentication_context_state (
            session_id, generation, status, storage_mode
          ) VALUES (?1, 1, '${status}', NULL)
          ON CONFLICT(session_id) DO UPDATE SET
            generation = session_authentication_context_state.generation + 1,
            status = '${status}',
            storage_mode = NULL
          RETURNING generation`,
        )
        .get(sessionId);
      if (!row || !Number.isSafeInteger(row.generation)) {
        throw new Error("Unable to reserve authentication context generation.");
      }
      if (status === "saving") {
        this.database
          .query(
            `INSERT INTO session_authentication_context_secret_keys (session_id, generation, status)
             VALUES (?1, ?2, 'writing')`,
          )
          .run(sessionId, row.generation);
      }
      return row.generation;
    });
    return reserve();
  }
}

export const authenticationContextStateRepository = new AuthenticationContextStateRepository();
