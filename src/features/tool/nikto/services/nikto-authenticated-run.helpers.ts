import { Buffer } from "node:buffer";
import { AuthenticatedRequestContext } from "../../../authentication/model/authenticated-request-context.types";
import {
  splitAuthenticatedCookieEntries,
  splitAuthenticatedHeaderEntries,
} from "../../../authentication/services/authenticated-request-context-redaction";
const headerNamePattern = /^[!#$%&'*+\-.^_`|~0-9A-Za-z]+$/;
const blockedHeaderNames = new Set([
  "connection",
  "content-length",
  "cookie",
  "host",
  "proxy-authorization",
  "proxy-connection",
  "transfer-encoding",
  "upgrade",
]);
const baseConfigSecretPattern =
  /^\s*(?:STATIC-COOKIE|CLIOPTS|PROXYUSER|PROXYPASS)\s*=/i;

export function buildNiktoAuthenticationConfig(
  context: AuthenticatedRequestContext,
  baseConfig = "",
) {
  const parsedHeaders = splitAuthenticatedHeaderEntries(context.headers).map(parseHeader);
  const cookieEntries = [
    ...splitAuthenticatedCookieEntries(context.cookies),
    ...parsedHeaders
      .filter((header) => header.name.toLowerCase() === "cookie")
      .flatMap((header) => splitAuthenticatedCookieEntries(header.value)),
  ];
  const cliOptions = parsedHeaders
    .filter((header) => header.name.toLowerCase() !== "cookie")
    .map(toNiktoHeaderOption);
  const sanitizedBaseConfig = sanitizeNiktoBaseConfig(baseConfig);
  const lines = [
    ...(sanitizedBaseConfig ? [sanitizedBaseConfig] : []),
    "CHECKMETHODS=GET",
    ...(/^\s*@@DEFAULT\s*=/im.test(sanitizedBaseConfig)
      ? []
      : ["@@DEFAULT=@@ALL"]),
  ];

  lines.push(`STATIC-COOKIE=${cookieEntries.map(encodeNiktoCookie).join(";")}`);
  lines.push(`CLIOPTS=${cliOptions.join(" ")}`);

  return `${lines.join("\n")}\n`;
}

function sanitizeNiktoBaseConfig(baseConfig: string) {
  return baseConfig
    .split(/\r?\n/)
    .filter((line) => !baseConfigSecretPattern.test(line))
    .join("\n")
    .trimEnd();
}

function parseHeader(entry: string) {
  const separatorIndex = entry.indexOf(":");
  const name = entry.slice(0, separatorIndex).trim();
  const value = entry.slice(separatorIndex + 1).trim();
  if (
    separatorIndex <= 0 ||
    !headerNamePattern.test(name) ||
    name.includes("#") ||
    !value ||
    /[\u0000-\u001f\u007f]/.test(value)
  ) {
    throw incompatibleContextError(name);
  }
  return { name, value };
}

function toNiktoHeaderOption(header: { name: string; value: string }) {
  const normalizedName = header.name.toLowerCase();
  if (normalizedName === "authorization") {
    return `-id=${decodeBasicAuthorization(header.value)}`;
  }
  if (
    blockedHeaderNames.has(normalizedName) ||
    /[\s#]/.test(header.value)
  ) {
    throw incompatibleContextError(header.name);
  }
  return `-Add-header=${header.name}:${header.value}`;
}

function decodeBasicAuthorization(value: string) {
  const match = /^Basic\s+([A-Za-z0-9+/]+={0,2})$/i.exec(value);
  if (!match) {
    throw incompatibleContextError("Authorization");
  }
  const encoded = match[1]!;
  const decoded = Buffer.from(encoded, "base64").toString("utf8");
  const normalizedEncoded = Buffer.from(decoded, "utf8").toString("base64").replace(/=+$/, "");
  if (
    normalizedEncoded !== encoded.replace(/=+$/, "") ||
    decoded.split(":").length !== 2 ||
    /[\s#\u0000-\u001f\u007f]/.test(decoded)
  ) {
    throw incompatibleContextError("Authorization");
  }
  return decoded;
}

function encodeNiktoCookie(entry: string) {
  const separatorIndex = entry.indexOf("=");
  const name = entry.slice(0, separatorIndex).trim();
  const value = entry.slice(separatorIndex + 1).trim();
  if (
    separatorIndex <= 0 ||
    !headerNamePattern.test(name) ||
    /["#\u0000-\u001f\u007f]/.test(value)
  ) {
    throw incompatibleContextError(`cookie ${name || "[unnamed]"}`);
  }
  return `"${name}=${value}"`;
}

function incompatibleContextError(name: string) {
  return new Error(
    `Authentication ${name || "header"} is not compatible with authenticated Nikto.`,
  );
}
