import {
  AuthenticationContextState,
  AuthenticationContextStateRow,
} from "../model/authentication-context-state.types";

const statuses = ["saving", "active", "clear_pending", "cleared"] as const;

export function parseAuthenticationContextState(
  row: AuthenticationContextStateRow,
): AuthenticationContextState {
  if (
    typeof row.sessionId !== "string" ||
    !Number.isSafeInteger(row.generation) ||
    row.generation < 0 ||
    !statuses.some((status) => status === row.status) ||
    (row.storageMode !== null && row.storageMode !== "memory" && row.storageMode !== "secure") ||
    (row.status === "active" && row.storageMode === null) ||
    (row.status !== "active" && row.storageMode !== null)
  ) {
    throw new Error("Authentication context state is invalid; context access is blocked.");
  }
  return {
    sessionId: row.sessionId,
    generation: row.generation,
    status: row.status as AuthenticationContextState["status"],
    storageMode: row.storageMode as AuthenticationContextState["storageMode"],
  };
}
