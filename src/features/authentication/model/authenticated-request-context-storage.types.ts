import { AuthenticatedRequestContext } from "./authenticated-request-context.types";

export interface StoredAuthenticatedRequestContext extends AuthenticatedRequestContext {
  version: 1 | 2 | 3;
  generation?: number;
}
