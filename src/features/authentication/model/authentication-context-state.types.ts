import { AuthenticatedContextStorageMode } from "./authenticated-request-context.types";

export type AuthenticationContextStateStatus = "saving" | "active" | "clear_pending" | "cleared";

export interface AuthenticationContextState {
  sessionId: string;
  generation: number;
  status: AuthenticationContextStateStatus;
  storageMode: AuthenticatedContextStorageMode | null;
}

export interface AuthenticationContextStateRow {
  sessionId: string;
  generation: number;
  status: string;
  storageMode: string | null;
}

export type AuthenticationContextClearResult =
  | { status: "cleared" }
  | { status: "pending" };
