import { CurlFieldId } from "../types/curl.types";

export const curlRequestTimeoutSeconds = 30;
export const curlMaximumRedirectCount = 5;
export const curlMaximumRequestBodyBytes = 256 * 1024;
export const curlMaximumResponseBytes = 2 * 1024 * 1024;

const publicFieldOrder = [
  "method",
  "targetUrl",
  "headers",
  "bodyMode",
  "body",
] as const satisfies readonly CurlFieldId[];

const authenticatedFieldOrder = [
  ...publicFieldOrder,
  "useAuthenticatedContext",
] as const satisfies readonly CurlFieldId[];

export function getCurlFieldOrder(isAuthenticationAvailable: boolean) {
  return isAuthenticationAvailable ? authenticatedFieldOrder : publicFieldOrder;
}

