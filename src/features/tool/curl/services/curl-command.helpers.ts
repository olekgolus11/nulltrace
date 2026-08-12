import { Buffer } from "node:buffer";
import {
  curlMaximumRequestBodyBytes,
} from "../config/curl.config";
import {
  CurlHttpMethod,
  CurlValidatedCommand,
} from "../types/curl.types";

const allowedMethods = new Set<CurlHttpMethod>([
  "GET",
  "HEAD",
  "POST",
  "PUT",
  "PATCH",
  "DELETE",
  "OPTIONS",
]);
const valueOptions = new Set([
  "-X",
  "--request",
  "-H",
  "--header",
  "-d",
  "--data",
  "--data-raw",
  "--data-binary",
  "--url",
]);
const blockedOptions = new Set([
  "-b",
  "--cookie",
  "-u",
  "--user",
  "--oauth2-bearer",
  "-K",
  "--config",
  "-k",
  "--insecure",
  "-L",
  "--location",
  "--location-trusted",
  "--proto-redir",
  "--max-redirs",
  "--connect-to",
  "--resolve",
  "-x",
  "--proxy",
  "--output",
  "-o",
  "--remote-name",
  "-O",
]);
const secretHeaderNames = new Set([
  "authorization",
  "cookie",
  "proxy-authorization",
]);
const blockedHeaderNames = new Set([
  ...secretHeaderNames,
  "connection",
  "content-length",
  "host",
  "proxy-connection",
  "transfer-encoding",
  "upgrade",
]);

export function quoteCurlShellValue(value: string) {
  return `'${value.split("'").join("'\\''")}'`;
}

export function tokenizeCurlCommand(command: string) {
  assertSafeCurlShell(command);
  const tokens: string[] = [];
  let token = "";
  let quote: "'" | '"' | null = null;
  let isEscaped = false;
  let hasToken = false;

  const finishToken = () => {
    if (!hasToken) return;
    tokens.push(token);
    token = "";
    hasToken = false;
  };

  for (const character of command) {
    if (isEscaped) {
      token += character;
      hasToken = true;
      isEscaped = false;
      continue;
    }
    if (character === "\\" && quote !== "'") {
      isEscaped = true;
      hasToken = true;
      continue;
    }
    if (quote) {
      if (character === quote) quote = null;
      else token += character;
      hasToken = true;
      continue;
    }
    if (character === "'" || character === '"') {
      quote = character;
      hasToken = true;
      continue;
    }
    if (/\s/.test(character)) {
      finishToken();
      continue;
    }
    token += character;
    hasToken = true;
  }

  if (quote || isEscaped) throw new Error("cURL command contains invalid shell quoting.");
  finishToken();
  return tokens;
}

export function validateCurlCommand(
  command: string,
  sessionTargetUrl: string,
): CurlValidatedCommand {
  const tokens = tokenizeCurlCommand(command.trim());
  if (tokens[0] !== "curl") throw new Error("The command must invoke curl directly.");

  let method: CurlHttpMethod = "GET";
  let targetUrl: string | null = null;
  let requestBody = "";
  for (let index = 1; index < tokens.length; index += 1) {
    const token = tokens[index]!;
    const equalsIndex = token.indexOf("=");
    const option = equalsIndex > 0 ? token.slice(0, equalsIndex) : token;
    const inlineValue = equalsIndex > 0 ? token.slice(equalsIndex + 1) : null;
    if (blockedOptions.has(option)) {
      throw new Error(`cURL option ${option} is managed by NullTrace and cannot be edited.`);
    }
    if (option.startsWith("-")) {
      if (!valueOptions.has(option)) {
        throw new Error(`Unsupported cURL option: ${option}.`);
      }
      const value = inlineValue ?? tokens[index + 1];
      if (value === undefined) throw new Error(`cURL option ${option} requires a value.`);
      if (inlineValue === null) index += 1;
      if (option === "-X" || option === "--request") method = normalizeCurlMethod(value);
      else if (option === "--url") targetUrl = value;
      else if (option === "-d" || option.startsWith("--data")) {
        if (value.startsWith("@")) {
          throw new Error("cURL request bodies cannot read from local files.");
        }
        requestBody += value;
      } else if (option === "-H" || option === "--header") validateCurlHeader(value);
      continue;
    }
    if (targetUrl) throw new Error("A cURL request must contain exactly one target URL.");
    targetUrl = token;
  }

  if (!targetUrl) throw new Error("A cURL request requires a target URL.");
  validateExactCurlOrigin(targetUrl, sessionTargetUrl);
  validateCurlRequestBodySize(requestBody);
  return { method, targetUrl, tokens };
}

export function validateExactCurlOrigin(targetUrl: string, sessionTargetUrl: string) {
  const target = parseHttpUrl(targetUrl, "cURL target");
  const sessionTarget = parseHttpUrl(sessionTargetUrl, "session target");
  if (target.username || target.password) {
    throw new Error("cURL target URLs cannot contain credentials.");
  }
  if (target.origin !== sessionTarget.origin) {
    throw new Error("cURL target must match the session target's exact origin.");
  }
}

export function validateCurlRequestBodySize(body: string) {
  if (Buffer.byteLength(body, "utf8") > curlMaximumRequestBodyBytes) {
    throw new Error("cURL request body cannot exceed 256 KiB.");
  }
}

export function normalizeCurlMethod(value: string): CurlHttpMethod {
  const normalized = value.trim().toUpperCase() as CurlHttpMethod;
  if (!allowedMethods.has(normalized)) throw new Error(`Unsupported HTTP method: ${value}.`);
  return normalized;
}

export function redactCurlCommand(command: string) {
  try {
    const tokens = tokenizeCurlCommand(command);
    const redacted: string[] = [];
    for (let index = 0; index < tokens.length; index += 1) {
      const token = tokens[index]!;
      if ((token === "-H" || token === "--header") && tokens[index + 1]) {
        redacted.push(token, "'[redacted]'");
        index += 1;
        continue;
      }
      if (/^(?:-H|--header)=/.test(token)) {
        redacted.push(`${token.slice(0, token.indexOf("="))}='[redacted]'`);
        continue;
      }
      if (["-d", "--data", "--data-raw", "--data-binary"].includes(token) && tokens[index + 1]) {
        redacted.push(token, "'[redacted]'");
        index += 1;
        continue;
      }
      if (/^(?:-d|--data(?:-raw|-binary)?)=/.test(token)) {
        redacted.push(`${token.slice(0, token.indexOf("="))}='[redacted]'`);
        continue;
      }
      if (["-b", "--cookie", "-u", "--user", "--oauth2-bearer"].includes(token) && tokens[index + 1]) {
        redacted.push(token, "'[redacted]'");
        index += 1;
        continue;
      }
      redacted.push(quoteCurlShellValue(token));
    }
    return redacted.join(" ");
  } catch {
    return "curl [redacted invalid command]";
  }
}

function assertSafeCurlShell(command: string) {
  let quote: "'" | '"' | null = null;
  let isEscaped = false;
  for (const character of command) {
    if (isEscaped) {
      isEscaped = false;
      continue;
    }
    if (character === "\\" && quote !== "'") {
      isEscaped = true;
      continue;
    }
    if (quote) {
      if (character === quote) quote = null;
      else if (character === "$" || character === "`") throw unsafeShellError();
      continue;
    }
    if (character === "'" || character === '"') quote = character;
    else if (`$\`;|&<>\n\r(){}*[]#`.includes(character)) throw unsafeShellError();
  }
}

function unsafeShellError() {
  return new Error("cURL commands cannot use shell expansion or control syntax.");
}

function validateCurlHeader(value: string) {
  if (value.startsWith("@") || /[\u0000-\u001f\u007f]/.test(value)) {
    throw new Error("cURL headers must be inline text values.");
  }
  const separator = value.indexOf(":");
  const name = separator > 0 ? value.slice(0, separator).trim().toLowerCase() : "";
  if (!name || blockedHeaderNames.has(name)) {
    throw new Error("Sensitive or transport-level cURL headers are managed by NullTrace.");
  }
}

function parseHttpUrl(value: string, label: string) {
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    throw new Error(`${label} must be an absolute HTTP URL.`);
  }
  if (url.protocol !== "http:" && url.protocol !== "https:") {
    throw new Error(`${label} must use HTTP or HTTPS.`);
  }
  return url;
}
