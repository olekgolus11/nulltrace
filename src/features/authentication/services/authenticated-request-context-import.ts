import { AuthenticatedRequestContextInput } from "../model/authenticated-request-context.types";
import { normalizeAuthenticatedRequestCookies } from "./authenticated-request-context-cookie.helpers";
import { normalizeExactOrigin } from "./authenticated-request-context.service";

interface ParsedHeader {
  name: string;
  value: string;
}

interface HarCookie {
  name: string;
  value: string;
}

interface HarRequest {
  method: string;
  url: string;
  headers: ParsedHeader[];
  cookies: HarCookie[];
}

export interface HarAuthenticationRequestSelection {
  entryIndex: number;
  method: string;
  path: string;
}

export interface HarAuthenticationContextImport {
  context: AuthenticatedRequestContextInput;
  verificationUrl: string;
}

const excludedHeaderNames = [
  "connection",
  "content-length",
  "host",
  "keep-alive",
  "proxy-authenticate",
  "proxy-authorization",
  "proxy-connection",
  "te",
  "trailer",
  "transfer-encoding",
  "upgrade",
] as const;

const ignoredCurlOptionsWithValues = [
  "--cacert",
  "--cert",
  "--connect-timeout",
  "--connect-to",
  "--cookie-jar",
  "--interface",
  "--key",
  "--max-time",
  "--output",
  "--proxy",
  "--referer",
  "--resolve",
  "--user-agent",
  "--upload-file",
  "--write-out",
  "-A",
  "-c",
  "-e",
  "-o",
  "-T",
  "-w",
  "-x",
] as const;

const ignoredCurlBodyOptionsWithValues = [
  "--data",
  "--data-ascii",
  "--data-binary",
  "--data-raw",
  "--data-urlencode",
  "--form",
  "--form-string",
  "--json",
  "--request",
  "-F",
  "-X",
  "-d",
] as const;

const ignoredCurlFlagOptions = [
  "--compressed",
  "--fail",
  "--fail-with-body",
  "--globoff",
  "--get",
  "--head",
  "--http1.1",
  "--http2",
  "--http2-prior-knowledge",
  "--insecure",
  "--location",
  "--path-as-is",
  "--show-error",
  "--silent",
  "-L",
  "-G",
  "-I",
  "-S",
  "-f",
  "-g",
  "-k",
  "-s",
  "-sS",
] as const;

function includesOption(options: readonly string[], candidate: string) {
  return options.some((option) => option === candidate);
}

function isExcludedHeader(name: string) {
  const normalizedName = name.toLowerCase();
  return (
    excludedHeaderNames.some((name) => name === normalizedName) ||
    normalizedName.startsWith("sec-fetch-") ||
    normalizedName.startsWith("sec-ch-ua") ||
    normalizedName.startsWith(":")
  );
}

function tokenizeCurlCommand(input: string) {
  const tokens: string[] = [];
  let token = "";
  let quote: "'" | '"' | null = null;
  let isEscaped = false;

  for (const character of input.trim()) {
    if (isEscaped) {
      token += character;
      isEscaped = false;
      continue;
    }
    if (character === "\\" && quote !== "'") {
      isEscaped = true;
      continue;
    }
    if (quote) {
      if (character === quote) {
        quote = null;
      } else {
        token += character;
      }
      continue;
    }
    if (character === "'" || character === '"') {
      quote = character;
      continue;
    }
    if (/\s/.test(character)) {
      if (token) {
        tokens.push(token);
        token = "";
      }
      continue;
    }
    token += character;
  }

  if (quote || isEscaped) {
    throw new Error("Could not parse the curl command. Check its quoting and try again.");
  }
  if (token) {
    tokens.push(token);
  }
  return tokens;
}

function parseHeader(value: string): ParsedHeader | null {
  const separatorIndex = value.indexOf(":");
  if (separatorIndex <= 0) {
    return null;
  }
  const name = value.slice(0, separatorIndex).trim();
  const headerValue = value.slice(separatorIndex + 1).trim();
  return name && headerValue ? { name, value: headerValue } : null;
}

function collectImportedHeader(value: string, headers: ParsedHeader[], cookies: string[]) {
  const header = parseHeader(value);
  if (header?.name.toLowerCase() === "cookie") {
    cookies.push(header.value);
  } else if (header && !isExcludedHeader(header.name)) {
    headers.push(header);
  }
}

function collectCurlCookie(value: string, cookies: string[]) {
  const cookie = value.trim();
  if (!cookie) {
    return;
  }
  if (!cookie.includes("=")) {
    throw new Error("Cookie file imports are unsupported. Paste ready-to-use cookies instead.");
  }
  cookies.push(cookie);
}

function parseHarRequests(input: string) {
  let parsed: unknown;
  try {
    parsed = JSON.parse(input) as unknown;
  } catch {
    throw new Error("Could not parse the HAR data. Select a valid HAR file.");
  }

  if (!parsed || typeof parsed !== "object" || !("log" in parsed)) {
    throw new Error("Unsupported HAR data. Expected a HAR request log.");
  }
  const log = parsed.log;
  if (!log || typeof log !== "object" || !("entries" in log) || !Array.isArray(log.entries)) {
    throw new Error("Unsupported HAR data. Expected a HAR request log.");
  }
  if (log.entries.length === 0) {
    throw new Error("The HAR data does not contain any requests.");
  }

  return log.entries.map((entry): HarRequest | null => {
    if (!entry || typeof entry !== "object" || !("request" in entry)) {
      return null;
    }
    const request = entry.request;
    if (
      !request ||
      typeof request !== "object" ||
      !("method" in request) ||
      !("url" in request) ||
      typeof request.method !== "string" ||
      typeof request.url !== "string"
    ) {
      return null;
    }
    const rawHeaders =
      "headers" in request && Array.isArray(request.headers) ? request.headers : [];
    const rawCookies =
      "cookies" in request && Array.isArray(request.cookies) ? request.cookies : [];
    const headers = rawHeaders.flatMap((header: unknown): ParsedHeader[] => {
      if (
        !header ||
        typeof header !== "object" ||
        !("name" in header) ||
        !("value" in header) ||
        typeof header.name !== "string" ||
        typeof header.value !== "string"
      ) {
        return [];
      }
      const name = header.name.trim();
      const value = header.value.trim();
      return name && value ? [{ name, value }] : [];
    });
    const cookies = rawCookies.flatMap((cookie: unknown): HarCookie[] => {
      if (
        !cookie ||
        typeof cookie !== "object" ||
        !("name" in cookie) ||
        !("value" in cookie) ||
        typeof cookie.name !== "string" ||
        typeof cookie.value !== "string"
      ) {
        return [];
      }
      const name = cookie.name.trim();
      return name ? [{ name, value: cookie.value }] : [];
    });
    return { method: request.method, url: request.url, headers, cookies };
  });
}

function getRequestUrl(value: string) {
  try {
    const url = new URL(value);
    if (url.protocol !== "http:" && url.protocol !== "https:") {
      return null;
    }
    return url;
  } catch {
    return null;
  }
}

function splitImportedHeaders(headers: ParsedHeader[]) {
  const cookies: string[] = [];
  const supportedHeaders: ParsedHeader[] = [];
  headers.forEach((header) => {
    if (header.name.toLowerCase() === "cookie") {
      cookies.push(header.value);
    } else if (!isExcludedHeader(header.name)) {
      supportedHeaders.push(header);
    }
  });
  return { cookies, supportedHeaders };
}

export function listHarAuthenticationRequests(
  input: string,
  targetUrl: string,
): HarAuthenticationRequestSelection[] {
  const targetOrigin = normalizeExactOrigin(targetUrl);
  const selections = parseHarRequests(input).flatMap(
    (request, entryIndex): HarAuthenticationRequestSelection[] => {
      const url = request ? getRequestUrl(request.url) : null;
      if (!request || !url || url.origin !== targetOrigin) {
        return [];
      }
      return [
        {
          entryIndex,
          method: request.method.toUpperCase(),
          path: url.pathname || "/",
        },
      ];
    },
  );
  if (selections.length === 0) {
    throw new Error("The HAR data does not contain any same-origin requests.");
  }
  return selections;
}

export function parseHarAuthenticationContextImport(
  input: string,
  targetUrl: string,
  entryIndex: number,
): HarAuthenticationContextImport {
  const targetOrigin = normalizeExactOrigin(targetUrl);
  const request = parseHarRequests(input)[entryIndex];
  if (!request) {
    throw new Error("The selected HAR request is unavailable.");
  }
  const requestUrl = getRequestUrl(request.url);
  if (!requestUrl || requestUrl.origin !== targetOrigin) {
    throw new Error("The selected HAR request must use the session target's exact origin.");
  }

  const { cookies: headerCookies, supportedHeaders } = splitImportedHeaders(request.headers);
  const cookies = normalizeAuthenticatedRequestCookies(
    headerCookies,
    request.cookies.map(({ name, value }) => `${name}=${value}`),
  );
  if (!cookies && supportedHeaders.length === 0) {
    throw new Error("The selected HAR request does not contain supported authentication material.");
  }
  requestUrl.hash = "";
  return {
    context: {
      origin: targetOrigin,
      cookies,
      headers: supportedHeaders.map(({ name, value }) => `${name}: ${value}`).join(" | "),
    },
    verificationUrl: requestUrl.toString(),
  };
}

export function parseHarAuthenticationContext(
  input: string,
  targetUrl: string,
  entryIndex: number,
): AuthenticatedRequestContextInput {
  return parseHarAuthenticationContextImport(input, targetUrl, entryIndex).context;
}

export interface CurlAuthenticationContextImport {
  context: AuthenticatedRequestContextInput;
  verificationUrl: string;
}

export function parseCurlAuthenticationContextImport(
  input: string,
  targetUrl: string,
): CurlAuthenticationContextImport {
  const tokens = tokenizeCurlCommand(input);
  if (!["curl", "curl.exe"].includes(tokens[0]?.toLowerCase() ?? "")) {
    throw new Error("Unsupported curl input. Paste a complete curl command.");
  }

  const headers: ParsedHeader[] = [];
  const headerCookies: string[] = [];
  const structuredCookies: string[] = [];
  let requestUrl: string | null = null;

  for (let index = 1; index < tokens.length; index += 1) {
    const token = tokens[index]!;
    if (token === "--url") {
      requestUrl = tokens[index + 1] ?? null;
      index += 1;
      continue;
    }
    if (token.startsWith("--url=")) {
      requestUrl = token.slice("--url=".length);
      continue;
    }
    if (token === "-H" || token === "--header") {
      collectImportedHeader(tokens[index + 1] ?? "", headers, headerCookies);
      index += 1;
      continue;
    }
    if (token.startsWith("-H") && token.length > 2) {
      collectImportedHeader(token.slice(2), headers, headerCookies);
      continue;
    }
    if (token.startsWith("--header=")) {
      collectImportedHeader(token.slice("--header=".length), headers, headerCookies);
      continue;
    }
    if (token === "-b" || token === "--cookie") {
      collectCurlCookie(tokens[index + 1] ?? "", structuredCookies);
      index += 1;
      continue;
    }
    if (token.startsWith("-b") && token.length > 2) {
      collectCurlCookie(token.slice(2), structuredCookies);
      continue;
    }
    if (token.startsWith("--cookie=")) {
      collectCurlCookie(token.slice("--cookie=".length), structuredCookies);
      continue;
    }
    if (includesOption(ignoredCurlBodyOptionsWithValues, token)) {
      index += 1;
      continue;
    }
    if (
      token.startsWith("--data=") ||
      token.startsWith("--data-ascii=") ||
      token.startsWith("--data-binary=") ||
      token.startsWith("--data-raw=") ||
      token.startsWith("--data-urlencode=") ||
      token.startsWith("--form=") ||
      token.startsWith("--form-string=") ||
      token.startsWith("--json=") ||
      token.startsWith("--request=") ||
      (token.startsWith("-d") && token.length > 2) ||
      (token.startsWith("-F") && token.length > 2) ||
      (token.startsWith("-X") && token.length > 2)
    ) {
      continue;
    }
    if (includesOption(ignoredCurlOptionsWithValues, token)) {
      index += 1;
      continue;
    }
    const optionName = token.split("=", 1)[0]!;
    if (token.includes("=") && includesOption(ignoredCurlOptionsWithValues, optionName)) {
      continue;
    }
    if (includesOption(ignoredCurlFlagOptions, token)) {
      continue;
    }
    if (token.startsWith("-")) {
      throw new Error("Unsupported curl option. Remove it and try again.");
    }
    if (!token.startsWith("-") && /^https?:\/\//i.test(token)) {
      requestUrl = token;
    }
  }

  const targetOrigin = normalizeExactOrigin(targetUrl);
  let requestOrigin: string | null = null;
  let verificationUrl: URL | null = null;
  if (requestUrl) {
    try {
      verificationUrl = new URL(requestUrl);
      verificationUrl.hash = "";
      requestOrigin = normalizeExactOrigin(requestUrl);
    } catch {
      throw new Error("The curl request must use a valid HTTP or HTTPS URL.");
    }
  }
  if (!requestOrigin || !verificationUrl || requestOrigin !== targetOrigin) {
    throw new Error("The curl request must use the session target's exact origin.");
  }
  if (headerCookies.length === 0 && structuredCookies.length === 0 && headers.length === 0) {
    throw new Error("The curl command does not contain supported authentication material.");
  }

  return {
    context: {
      origin: targetOrigin,
      cookies: normalizeAuthenticatedRequestCookies(headerCookies, structuredCookies),
      headers: headers.map(({ name, value }) => `${name}: ${value}`).join(" | "),
    },
    verificationUrl: verificationUrl.toString(),
  };
}

export function parseCurlAuthenticationContext(
  input: string,
  targetUrl: string,
): AuthenticatedRequestContextInput {
  return parseCurlAuthenticationContextImport(input, targetUrl).context;
}
