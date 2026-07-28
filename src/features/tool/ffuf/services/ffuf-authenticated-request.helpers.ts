import { AuthenticatedRequestContext } from "../../../authentication/model/authenticated-request-context.types";
import {
  splitAuthenticatedCookieEntries,
  splitAuthenticatedHeaderEntries,
} from "../../../authentication/services/authenticated-request-context-redaction";
import { FfufToolData } from "../types/ffuf.types";

const ffufTargetFlagPattern =
  /\s+-u(?:\s+|=)(?:'[^']*'|"(?:\\.|[^"])*"|\S+)/g;
const ffufMethodFlagPattern = /\s+-X(?:\s+|=)(?:'[^']*'|"(?:\\.|[^"])*"|\S+)/g;
const ffufDataFlagPattern = /\s+-(?:d|data)(?:\s+|=)(?:'[^']*'|"(?:\\.|[^"])*"|\S+)/g;
const ffufHeaderFlagPattern = /\s+-H(?:\s+|=)(?:'[^']*'|"(?:\\.|[^"])*"|\S+)/g;
const ffufRedirectFlagPattern = /(?:^|\s)-(?:r|redirect)(?=\s|=|$)/;
const ffufCookieFlagPattern = /(?:^|\s)-(?:b|cookie)(?=\s|=|$)/;
const ffufRawRequestFlagPattern = /(?:^|\s)-request(?:-proto)?(?=\s|=|$)/;
const ffufOutputFlagPattern =
  /\s+(?:-o|-output)(?:\s+|=)(?:'[^']*'|"(?:\\.|[^"])*"|\S+)/g;
const headerNamePattern = /^[!#$%&'*+\-.^_`|~0-9A-Za-z]+$/;
const blockedHeaderNames = new Set([
  "connection",
  "content-length",
  "host",
  "proxy-connection",
  "transfer-encoding",
  "upgrade",
]);
const allowedPublicHeaderNames = new Set([
  "accept",
  "accept-encoding",
  "accept-language",
  "cache-control",
  "content-type",
  "pragma",
  "user-agent",
  "x-requested-with",
]);

export function buildAuthenticatedFfufRawRequest(
  targetUrl: string,
  toolData: FfufToolData,
  context: AuthenticatedRequestContext,
) {
  const target = new URL(targetUrl);
  const headers = parseCompatibleHeaders(context.headers);
  const cookieEntries = [
    ...splitAuthenticatedCookieEntries(context.cookies),
    ...headers
      .filter((header) => header.name.toLowerCase() === "cookie")
      .flatMap((header) => splitAuthenticatedCookieEntries(header.value)),
  ];
  const requestHeaders = headers.filter((header) => header.name.toLowerCase() !== "cookie");
  const requestShape = getFfufRawRequestShape(target, toolData);
  const hasContentType = requestHeaders.some(
    (header) => header.name.toLowerCase() === "content-type",
  );
  const lines = [
    `${requestShape.method} ${requestShape.requestTarget} HTTP/1.1`,
    `Host: ${target.host}`,
    ...(cookieEntries.length > 0 ? [`Cookie: ${cookieEntries.join("; ")}`] : []),
    ...requestHeaders.map((header) => `${header.name}: ${header.value}`),
    ...(requestShape.body && !hasContentType
      ? ["Content-Type: application/x-www-form-urlencoded"]
      : []),
    ...(requestShape.fuzzHeader ? [requestShape.fuzzHeader] : []),
    "",
    requestShape.body,
  ];

  return lines.join("\r\n");
}

export function replaceFfufRequestWithRawRequest(
  command: string,
  secretFilePath: string,
  protocol: string,
) {
  validateAuthenticatedFfufCommandForDraft(command);
  const stripped = command
    .replace(ffufTargetFlagPattern, " ")
    .replace(ffufMethodFlagPattern, " ")
    .replace(ffufDataFlagPattern, " ")
    .replace(ffufHeaderFlagPattern, " ")
    .replace(/\s+/g, " ")
    .trim();
  return `${stripped} -request ${shellQuoteFfufValue(secretFilePath)} -request-proto ${protocol}`;
}

export function replaceFfufOutputPath(command: string, outputPath: string) {
  const stripped = command.replace(ffufOutputFlagPattern, " ").replace(/\s+/g, " ").trim();
  return `${stripped} -o ${shellQuoteFfufValue(outputPath)}`;
}

export function validateAuthenticatedFfufCommandForDraft(command: string) {
  if (ffufRedirectFlagPattern.test(command)) {
    throw new Error(
      "Authenticated FFUF runs cannot follow redirects because credentials are exact-origin.",
    );
  }
  validateFfufCommandSecretInputs(command);
  const headerFlags = readFfufHeaderFlags(command);
  if (headerFlags.some((header) => !header.includes("FUZZ"))) {
    throw new Error(
      "Authenticated FFUF commands cannot include manual request headers.",
    );
  }
  validateFfufCommandTargetCredentials(command);
}

export function validateFfufCommandSecretInputs(command: string) {
  if (ffufCookieFlagPattern.test(command) || ffufRawRequestFlagPattern.test(command)) {
    throw new Error(
      "Authenticated FFUF commands must source credentials only from selected session context.",
    );
  }
  const unsupportedHeader = readFfufHeaderFlags(command).find((header) => {
    const normalized = header.replace(/^(['"])(.*)\1$/, "$2");
    const separatorIndex = normalized.indexOf(":");
    const name =
      separatorIndex >= 0 ? normalized.slice(0, separatorIndex).trim() : normalized.trim();
    const value = separatorIndex >= 0 ? normalized.slice(separatorIndex + 1).trim() : "";
    if (name === "FUZZ" || value === "FUZZ") return false;
    return !allowedPublicHeaderNames.has(name.toLowerCase());
  });
  if (unsupportedHeader) {
    throw new Error(
      "FFUF request headers outside approved public headers must come from selected session context.",
    );
  }
  validateFfufCommandTargetCredentials(command);
}

export function validateAuthenticatedFfufTarget(target: string) {
  const url = new URL(target);
  if (url.username || url.password) {
    throw new Error("Authenticated FFUF draft targets must not contain credentials.");
  }
}

function validateFfufCommandTargetCredentials(command: string) {
  const targetPattern =
    /(?:^|\s)-u(?:\s+|=)(?:'([^']*)'|"([^"]*)"|(\S+))/g;
  for (const match of command.matchAll(targetPattern)) {
    const target = match[1] ?? match[2] ?? match[3];
    if (target) validateAuthenticatedFfufTarget(target);
  }
}

function readFfufHeaderFlags(command: string) {
  return [...command.matchAll(new RegExp(ffufHeaderFlagPattern.source, "g"))].map((match) =>
    match[0].replace(/^\s+-H(?:\s+|=)/, "").trim(),
  );
}

function getFfufRawRequestShape(target: URL, toolData: FfufToolData) {
  const requestTarget = `${target.pathname}${target.search}` || "/";
  if (toolData.mode === "parameter_discovery") {
    if (toolData.form.requestLocation === "body") {
      return {
        method: "POST",
        requestTarget,
        body: "FUZZ=nulltrace",
        fuzzHeader: null,
      };
    }
    if (toolData.form.requestLocation === "header") {
      return {
        method: "GET",
        requestTarget,
        body: "",
        fuzzHeader: "FUZZ: nulltrace",
      };
    }
  }
  if (toolData.mode === "value_fuzzing") {
    if (toolData.form.requestLocation === "body") {
      return {
        method: "POST",
        requestTarget,
        body: `${toolData.form.parameterName}=FUZZ`,
        fuzzHeader: null,
      };
    }
    if (toolData.form.requestLocation === "header") {
      return {
        method: "GET",
        requestTarget,
        body: "",
        fuzzHeader: `${toolData.form.parameterName}: FUZZ`,
      };
    }
  }
  return {
    method: "GET",
    requestTarget,
    body: "",
    fuzzHeader: null,
  };
}

function parseCompatibleHeaders(value: string) {
  return splitAuthenticatedHeaderEntries(value).map((entry) => {
    const separatorIndex = entry.indexOf(":");
    const name = entry.slice(0, separatorIndex).trim();
    const headerValue = entry.slice(separatorIndex + 1).trim();
    if (
      !headerNamePattern.test(name) ||
      blockedHeaderNames.has(name.toLowerCase()) ||
      !headerValue ||
      /[\u0000-\u0008\u000a-\u001f\u007f]/.test(headerValue)
    ) {
      throw new Error(
        `Authentication header ${name || "[unnamed]"} is not compatible with authenticated FFUF.`,
      );
    }
    return { name, value: headerValue };
  });
}

function shellQuoteFfufValue(value: string) {
  return `'${value.split("'").join("'\\''")}'`;
}
