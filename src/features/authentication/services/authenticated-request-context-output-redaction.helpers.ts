import { AuthenticatedRequestContext } from "../model/authenticated-request-context.types";
import { partitionAuthenticatedRequestCookieHeaders } from "./authenticated-request-context-cookie.helpers";
import {
  splitAuthenticatedCookieEntries,
  splitAuthenticatedHeaderEntries,
} from "./authenticated-request-context-redaction";

export function createAuthenticatedRequestContextOutputRedactor(
  context: AuthenticatedRequestContext,
  maximumOutputBytes?: number,
) {
  if (maximumOutputBytes !== undefined && (!Number.isSafeInteger(maximumOutputBytes) || maximumOutputBytes < 1)) {
    throw new Error("Invalid authentication output redaction limit.");
  }
  const { literalValues, shortValues } = collectSecretValues(context);

  return (content: string) => {
    if (maximumOutputBytes !== undefined && Buffer.byteLength(content) > maximumOutputBytes) {
      throw new Error("Authentication output redaction limit exceeded.");
    }
    const literalRedacted = literalValues.reduce((redacted, secret) => maximumOutputBytes === undefined
      ? redacted.split(secret).join("[redacted]")
      : replaceLiteralWithinLimit(redacted, secret, maximumOutputBytes), content);
    return shortValues.reduce((redacted, secret) => maximumOutputBytes === undefined
      ? redactBoundedValue(redacted, secret)
      : redactBoundedValueWithinLimit(redacted, secret, maximumOutputBytes), literalRedacted);
  };
}

export function createAuthenticatedRequestContextJsonRedactor(
  context: AuthenticatedRequestContext,
) {
  const redactOutput = createAuthenticatedRequestContextOutputRedactor(context);

  return (content: string) => redactJsonValueText(content, redactOutput);
}

function collectSecretValues(context: AuthenticatedRequestContext) {
  const { headerDerivedCookies } = partitionAuthenticatedRequestCookieHeaders(context.headers);
  const cookieEntries = [context.cookies, ...headerDerivedCookies].flatMap(
    splitAuthenticatedCookieEntries,
  );
  const headerEntries = splitAuthenticatedHeaderEntries(context.headers);
  const cookieNames = cookieEntries.map(getNameBeforeSeparator("="));
  const headerValues = headerEntries.map(getValueAfterSeparator(":"));
  const decodedBasicValues = headerValues
    .map(decodeBasicAuthenticationValue)
    .filter(Boolean);
  const literalValues = [context.cookies.trim(), ...cookieEntries, ...headerEntries].filter(
    Boolean,
  );
  const standaloneValues = [
    ...cookieNames,
    ...cookieEntries.map(getValueAfterSeparator("=")),
    ...headerValues,
    ...headerValues.map(stripAuthenticationScheme),
    ...decodedBasicValues,
  ].filter(Boolean);

  return {
    literalValues: [...new Set([...literalValues, ...standaloneValues.filter(isLongSecret)])].sort(
      (left, right) => right.length - left.length,
    ),
    shortValues: [...new Set(standaloneValues.filter((value) => !isLongSecret(value)))],
  };
}

function decodeBasicAuthenticationValue(value: string) {
  const match = /^Basic\s+([A-Za-z0-9+/]+={0,2})$/i.exec(value);
  if (!match) return "";
  try {
    return Buffer.from(match[1]!, "base64").toString("utf8");
  } catch {
    return "";
  }
}

function redactJsonValueText(content: string, redactOutput: (value: string) => string) {
  try {
    return JSON.stringify(redactJsonValue(JSON.parse(content) as unknown, redactOutput));
  } catch {
    return redactOutput(content);
  }
}

function redactJsonValue(value: unknown, redactOutput: (content: string) => string): unknown {
  if (typeof value === "string") {
    return redactOutput(value);
  }
  if (Array.isArray(value)) {
    return value.map((entry) => redactJsonValue(entry, redactOutput));
  }
  if (!value || typeof value !== "object") {
    const primitive = String(value);
    const redacted = redactOutput(primitive);
    return redacted === primitive ? value : redacted;
  }
  return Object.fromEntries(
    Object.entries(value).map(([key, entry]) => [
      redactOutput(key),
      redactJsonValue(entry, redactOutput),
    ]),
  );
}

function isLongSecret(value: string) {
  return value.length >= 8;
}

function redactBoundedValue(content: string, value: string) {
  const pattern = new RegExp(`(^|[^A-Za-z0-9])${escapeRegex(value)}(?=$|[^A-Za-z0-9])`, "g");
  return content.replace(pattern, "$1[redacted]");
}

function replaceLiteralWithinLimit(content: string, value: string, maximumOutputBytes: number) {
  if (!value) return content;
  const replacement = "[redacted]";
  let count = 0;
  let offset = 0;
  const baseBytes = Buffer.byteLength(content);
  const replacementBytes = Buffer.byteLength(replacement);
  const valueBytes = Buffer.byteLength(value);
  while ((offset = content.indexOf(value, offset)) !== -1) {
    count += 1;
    if (baseBytes + count * (replacementBytes - valueBytes) > maximumOutputBytes) {
      throw new Error("Authentication output redaction limit exceeded.");
    }
    offset += value.length;
  }
  return content.split(value).join(replacement);
}

function redactBoundedValueWithinLimit(content: string, value: string, maximumOutputBytes: number) {
  if (!value) return content;
  const pattern = new RegExp(`(^|[^A-Za-z0-9])${escapeRegex(value)}(?=$|[^A-Za-z0-9])`, "g");
  let count = 0;
  const baseBytes = Buffer.byteLength(content);
  const replacementBytes = Buffer.byteLength("[redacted]");
  const valueBytes = Buffer.byteLength(value);
  for (const _match of content.matchAll(pattern)) {
    count += 1;
    if (baseBytes + count * (replacementBytes - valueBytes) > maximumOutputBytes) {
      throw new Error("Authentication output redaction limit exceeded.");
    }
  }
  return content.replace(pattern, "$1[redacted]");
}

function escapeRegex(value: string) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function stripAuthenticationScheme(value: string) {
  const separatorIndex = value.indexOf(" ");
  return separatorIndex === -1 ? value : value.slice(separatorIndex + 1).trim();
}

function getValueAfterSeparator(separator: string) {
  return (entry: string) => {
    const separatorIndex = entry.indexOf(separator);
    return separatorIndex === -1 ? "" : entry.slice(separatorIndex + 1).trim();
  };
}

function getNameBeforeSeparator(separator: string) {
  return (entry: string) => {
    const separatorIndex = entry.indexOf(separator);
    return separatorIndex === -1 ? "" : entry.slice(0, separatorIndex).trim();
  };
}
