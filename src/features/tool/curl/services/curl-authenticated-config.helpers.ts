import { AuthenticatedRequestContext } from "../../../authentication/model/authenticated-request-context.types";
import {
  splitAuthenticatedCookieEntries,
  splitAuthenticatedHeaderEntries,
} from "../../../authentication/services/authenticated-request-context-redaction";

const headerNamePattern = /^[!#$%&'*+\-.^_`|~0-9A-Za-z]+$/;
const blockedHeaderNames = new Set([
  "connection",
  "content-length",
  "host",
  "proxy-authorization",
  "proxy-connection",
  "transfer-encoding",
  "upgrade",
]);

export function buildAuthenticatedCurlConfig(context: AuthenticatedRequestContext) {
  const headers = splitAuthenticatedHeaderEntries(context.headers).map(parseHeader);
  const cookies = [
    ...splitAuthenticatedCookieEntries(context.cookies),
    ...headers
      .filter((header) => header.name.toLowerCase() === "cookie")
      .flatMap((header) => splitAuthenticatedCookieEntries(header.value)),
  ];
  const configLines = headers
    .filter((header) => header.name.toLowerCase() !== "cookie")
    .map((header) => `header = ${quoteCurlConfigValue(`${header.name}: ${header.value}`)}`);
  if (cookies.length > 0) {
    configLines.push(`cookie = ${quoteCurlConfigValue(cookies.join("; "))}`);
  }
  return `${configLines.join("\n")}\n`;
}

function parseHeader(entry: string) {
  const separatorIndex = entry.indexOf(":");
  const name = entry.slice(0, separatorIndex).trim();
  const value = entry.slice(separatorIndex + 1).trim();
  if (
    separatorIndex <= 0 ||
    !headerNamePattern.test(name) ||
    blockedHeaderNames.has(name.toLowerCase()) ||
    !value ||
    /[\u0000-\u001f\u007f]/.test(value)
  ) {
    throw new Error(
      `Authentication header ${name || "[unnamed]"} is not compatible with cURL.`,
    );
  }
  return { name, value };
}

function quoteCurlConfigValue(value: string) {
  return `"${value.replace(/\\/g, "\\\\").replace(/"/g, '\\"')}"`;
}

