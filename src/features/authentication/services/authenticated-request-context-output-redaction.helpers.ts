import { AuthenticatedRequestContext } from "../model/authenticated-request-context.types";
import { splitAuthenticatedHeaderEntries } from "./authenticated-request-context-redaction";

export function createAuthenticatedRequestContextOutputRedactor(
  context: AuthenticatedRequestContext,
) {
  const { literalValues, shortValues } = collectSecretValues(context);

  return (content: string) => {
    const literalRedacted = literalValues.reduce(
      (redacted, secret) => redacted.split(secret).join("[redacted]"),
      content,
    );
    return shortValues.reduce(
      (redacted, secret) => redactBoundedValue(redacted, secret),
      literalRedacted,
    );
  };
}

export function createAuthenticatedRequestContextJsonRedactor(
  context: AuthenticatedRequestContext,
) {
  const redactOutput = createAuthenticatedRequestContextOutputRedactor(context);

  return (content: string) => redactJsonValueText(content, redactOutput);
}

function collectSecretValues(context: AuthenticatedRequestContext) {
  const cookieEntries = context.cookies
    .split(/[;\n\r]+/)
    .map((entry) => entry.trim())
    .filter(Boolean);
  const headerEntries = splitAuthenticatedHeaderEntries(context.headers);
  const headerValues = headerEntries.map(getValueAfterSeparator(":"));
  const literalValues = [context.cookies.trim(), ...cookieEntries, ...headerEntries].filter(
    Boolean,
  );
  const standaloneValues = [
    ...cookieEntries.map(getValueAfterSeparator("=")),
    ...headerValues,
    ...headerValues.map(stripAuthenticationScheme),
  ].filter(Boolean);

  return {
    literalValues: [...new Set([...literalValues, ...standaloneValues.filter(isLongSecret)])].sort(
      (left, right) => right.length - left.length,
    ),
    shortValues: [...new Set(standaloneValues.filter((value) => !isLongSecret(value)))],
  };
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
    Object.entries(value).map(([key, entry]) => [key, redactJsonValue(entry, redactOutput)]),
  );
}

function isLongSecret(value: string) {
  return value.length >= 8;
}

function redactBoundedValue(content: string, value: string) {
  const pattern = new RegExp(`(^|[^A-Za-z0-9])${escapeRegex(value)}(?=$|[^A-Za-z0-9])`, "g");
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
