import { AuthenticatedRequestContext } from "../../../authentication/model/authenticated-request-context.types";
import { splitAuthenticatedHeaderEntries } from "../../../authentication/services/authenticated-request-context-redaction";
import { normalizeExactOrigin } from "../../../authentication/services/authenticated-request-context.service";

export function buildNucleiSecretFile(context: AuthenticatedRequestContext) {
  const exactOrigin = normalizeExactOrigin(context.origin);
  // Nuclei matches Secret File entries against URL.host, so the file carries the
  // narrowest supported authority scope. The run boundary separately enforces
  // the normalized target scheme and disables redirects and custom templates.
  const domain = new URL(exactOrigin).host;
  const exactDomainPattern = `^${escapeRegex(domain)}$`;
  const cookies = parseCookieEntries(context.cookies);
  const headers = parseHeaderEntries(context.headers);
  const secretHeaders = [
    ...(cookies.length > 0
      ? [
          {
            key: "Cookie",
            value: cookies.map((cookie) => `${cookie.key}=${cookie.value}`).join("; "),
          },
        ]
      : []),
    ...headers.filter((header) => cookies.length === 0 || header.key.toLowerCase() !== "cookie"),
  ];
  const lines = [`# nulltrace-exact-origin: ${quoteYaml(exactOrigin)}`, "static:"];

  if (secretHeaders.length > 0) {
    lines.push(
      "  - type: header",
      "    domains-regex:",
      `      - ${quoteYaml(exactDomainPattern)}`,
      "    headers:",
      ...secretHeaders.flatMap((header) => [
        `      - key: ${quoteYaml(header.key)}`,
        `        value: ${quoteYaml(header.value)}`,
      ]),
    );
  }

  return `${lines.join("\n")}\n`;
}

function quoteYaml(value: string) {
  return JSON.stringify(value);
}

function escapeRegex(value: string) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function parseCookieEntries(value: string) {
  return value
    .split(/[;\n\r]+/)
    .map((entry) => entry.trim())
    .filter(Boolean)
    .map((entry) => {
      const separatorIndex = entry.indexOf("=");
      return {
        key: separatorIndex === -1 ? entry : entry.slice(0, separatorIndex).trim(),
        value: separatorIndex === -1 ? "" : entry.slice(separatorIndex + 1).trim(),
      };
    })
    .filter((entry) => entry.key);
}

function parseHeaderEntries(value: string) {
  return splitAuthenticatedHeaderEntries(value)
    .map((entry) => {
      const separatorIndex = entry.indexOf(":");
      return {
        key: entry.slice(0, separatorIndex).trim(),
        value: entry.slice(separatorIndex + 1).trim(),
      };
    })
    .filter((entry) => entry.key && entry.value);
}
