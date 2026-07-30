import { AuthenticatedRequestContext } from "../../../authentication/model/authenticated-request-context.types";
import {
  createAuthenticatedRequestContextJsonRedactor,
  createAuthenticatedRequestContextOutputRedactor,
} from "../../../authentication/services/authenticated-request-context-output-redaction.helpers";

export function createAuthenticatedNucleiOutputRedactor(context: AuthenticatedRequestContext) {
  return createAuthenticatedRequestContextOutputRedactor(context);
}

export function createAuthenticatedNucleiJsonlRedactor(context: AuthenticatedRequestContext) {
  const redactJson = createAuthenticatedRequestContextJsonRedactor(context);
  return (content: string) =>
    content
      .split(/\r?\n/)
      .map((line) => (line.trim() ? redactJson(line) : line))
      .join("\n");
}
