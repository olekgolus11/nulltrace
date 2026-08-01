import { AuthenticatedRequestContext } from "../../../authentication/model/authenticated-request-context.types";
import {
  splitAuthenticatedCookieEntries,
  splitAuthenticatedHeaderEntries,
} from "../../../authentication/services/authenticated-request-context-redaction";
import { SqlmapValidatedCommandOption } from "../types/sqlmap.types";
import {
  quoteSqlmapShellValue,
  validateTargetedSqlmapCommand,
} from "./sqlmap-command.helpers";

const headerNamePattern = /^[!#$%&'*+\-.^_`|~0-9A-Za-z]+$/;
const blockedHeaderNames = new Set([
  "connection",
  "content-length",
  "host",
  "proxy-connection",
  "transfer-encoding",
  "upgrade",
]);

export function buildAuthenticatedSqlmapRawRequest(
  command: string,
  context: AuthenticatedRequestContext,
) {
  const validated = validateTargetedSqlmapCommand(command);
  const target = new URL(validated.targetUrl);
  const headers = parseCompatibleHeaders(context.headers);
  const cookieEntries = [
    ...splitAuthenticatedCookieEntries(context.cookies),
    ...headers
      .filter((header) => header.name.toLowerCase() === "cookie")
      .flatMap((header) => splitAuthenticatedCookieEntries(header.value)),
  ];
  const requestHeaders = headers.filter(
    (header) => header.name.toLowerCase() !== "cookie",
  );
  if (cookieEntries.length === 0 && requestHeaders.length === 0) {
    throw new Error(
      "Authentication context does not contain compatible HTTP cookies or headers for authenticated sqlmap.",
    );
  }
  if (
    validated.body !== null &&
    !requestHeaders.some((header) => header.name.toLowerCase() === "content-type")
  ) {
    requestHeaders.push({
      name: "Content-Type",
      value: getDefaultContentType(validated.body),
    });
  }
  const requestTarget = `${target.pathname}${target.search}` || "/";
  return [
    `${validated.method} ${requestTarget} HTTP/1.1`,
    `Host: ${target.host}`,
    ...(cookieEntries.length > 0 ? [`Cookie: ${cookieEntries.join("; ")}`] : []),
    ...requestHeaders.map((header) => `${header.name}: ${header.value}`),
    "",
    validated.body ?? "",
  ].join("\r\n");
}

export function replaceSqlmapRequestWithRawRequest(
  command: string,
  secretFilePath: string,
) {
  const validated = validateTargetedSqlmapCommand(command);
  const isHttpsTarget = new URL(validated.targetUrl).protocol === "https:";
  const retainedOptions = validated.options.filter(
    (option) =>
      option.name !== "-u" &&
      option.name !== "--url" &&
      option.name !== "--method" &&
      option.name !== "--data",
  );
  return [
    "sqlmap",
    "-r",
    quoteSqlmapShellValue(secretFilePath),
    "--ignore-redirects",
    ...(isHttpsTarget ? ["--force-ssl"] : []),
    ...retainedOptions.flatMap(formatSqlmapOption),
  ].join(" ");
}

function getDefaultContentType(body: string) {
  try {
    JSON.parse(body);
    return "application/json";
  } catch {
    return "application/x-www-form-urlencoded";
  }
}

function formatSqlmapOption(option: SqlmapValidatedCommandOption) {
  if (option.value === null) return [option.name];
  return [option.name, quoteSqlmapShellValue(option.value)];
}

function parseCompatibleHeaders(value: string) {
  return splitAuthenticatedHeaderEntries(value).map((entry) => {
    const separatorIndex = entry.indexOf(":");
    const name = separatorIndex >= 0 ? entry.slice(0, separatorIndex).trim() : "";
    const headerValue = separatorIndex >= 0 ? entry.slice(separatorIndex + 1).trim() : "";
    if (
      !headerNamePattern.test(name) ||
      blockedHeaderNames.has(name.toLowerCase()) ||
      !headerValue ||
      /[\u0000-\u0008\u000a-\u001f\u007f]/.test(headerValue)
    ) {
      throw new Error(
        `Authentication header ${name || "[unnamed]"} is not compatible with authenticated sqlmap.`,
      );
    }
    return { name, value: headerValue };
  });
}
