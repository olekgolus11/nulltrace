import { existsSync, readFileSync, rmSync } from "node:fs";
import { dirname, join } from "node:path";
import { CurlExecutionInput } from "./curl-execution.types";

const configPath = process.argv[2];
if (!configPath) throw new Error("Missing cURL execution config.");
const input = JSON.parse(readFileSync(configPath, "utf8")) as CurlExecutionInput;
const runDirectory = dirname(configPath);
const startedAt = performance.now();
let currentUrl = input.targetUrl;
let currentMethod = input.method;
let tokens = input.tokens.slice(1);
let redirectCount = 0;

while (true) {
  const elapsedSeconds = (performance.now() - startedAt) / 1000;
  const remainingSeconds = Math.max(0.001, input.timeoutSeconds - elapsedSeconds);
  const headerPath = join(runDirectory, `response-${redirectCount}.headers`);
  const bodyPath = join(runDirectory, `response-${redirectCount}.body`);
  const requestTokens = replaceCurlTarget(tokens, currentUrl);
  const args = [
    "curl",
    ...requestTokens,
    ...(currentMethod === "HEAD" ? ["--head"] : []),
    ...(input.authenticationConfigPath ? ["--config", input.authenticationConfigPath] : []),
    "--max-redirs", "0",
    "--max-filesize", String(input.maximumResponseBytes),
    "--connect-timeout", String(Math.min(remainingSeconds, input.timeoutSeconds)),
    "--max-time", String(remainingSeconds),
    "--silent", "--show-error",
    "--dump-header", headerPath,
    "--output", bodyPath,
    "--write-out", "%{http_code}\t%{time_total}\t%{url_effective}",
  ];
  const child = Bun.spawn({ cmd: args, stdout: "pipe", stderr: "pipe", stdin: "ignore" });
  const [stdout, stderr, exitCode] = await Promise.all([
    new Response(child.stdout).text(),
    new Response(child.stderr).text(),
    child.exited,
  ]);
  const [statusText = "000", time = "0", effectiveUrl = currentUrl] = stdout.split("\t");
  const status = Number.parseInt(statusText, 10);
  const rawHeaders = existsSync(headerPath) ? readFileSync(headerPath, "utf8") : "";
  const body = existsSync(bodyPath)
    ? readFileSync(bodyPath).subarray(0, input.maximumResponseBytes)
    : Buffer.alloc(0);

  const location = readLastResponseHeader(rawHeaders, "location");
  if (!isRedirectStatus(status) || !location) {
    const safeHeaders = redactResponseHeaders(rawHeaders, input.exactOrigin);
    if (safeHeaders) console.log(safeHeaders);
    if (body.length > 0 && currentMethod !== "HEAD") console.log(body.toString("utf8"));
    console.log(`[http ${statusText}] ${time}s ${formatSafeUrl(effectiveUrl)}`);
    if (stderr.trim()) console.error(stderr.trim());
    removeResponseFiles(headerPath, bodyPath);
    process.exitCode = exitCode;
    break;
  }
  if (redirectCount >= input.maximumRedirectCount) {
    removeResponseFiles(headerPath, bodyPath);
    throw new Error(`cURL redirect limit exceeded (${input.maximumRedirectCount}).`);
  }
  const nextUrl = new URL(location, currentUrl);
  if (nextUrl.origin !== input.exactOrigin) {
    removeResponseFiles(headerPath, bodyPath);
    throw new Error("cURL refused a redirect outside the session target's exact origin.");
  }
  removeResponseFiles(headerPath, bodyPath);
  redirectCount += 1;
  if ([301, 302, 303].includes(status) && currentMethod !== "GET" && currentMethod !== "HEAD") {
    currentMethod = "GET";
    tokens = replaceCurlMethod(removeCurlRequestBody(tokens), "GET");
  }
  currentUrl = nextUrl.toString();
}

function replaceCurlTarget(tokens: string[], targetUrl: string) {
  const next = [...tokens];
  for (let index = 0; index < next.length; index += 1) {
    const token = next[index]!;
    if (token === "--url") {
      next[index + 1] = targetUrl;
      return next;
    }
    if (token.startsWith("--url=")) {
      next[index] = `--url=${targetUrl}`;
      return next;
    }
    if (!token.startsWith("-")) {
      next[index] = targetUrl;
      return next;
    }
    if (["-X", "--request", "-H", "--header", "-d", "--data", "--data-raw", "--data-binary"].includes(token)) index += 1;
  }
  throw new Error("Missing cURL target URL.");
}

function replaceCurlMethod(tokens: string[], method: string) {
  const next = [...tokens];
  for (let index = 0; index < next.length; index += 1) {
    if (next[index] === "-X" || next[index] === "--request") {
      next[index + 1] = method;
      return next;
    }
  }
  return ["-X", method, ...next];
}

function removeCurlRequestBody(tokens: string[]) {
  const next: string[] = [];
  for (let index = 0; index < tokens.length; index += 1) {
    const token = tokens[index]!;
    if (["-d", "--data", "--data-raw", "--data-binary"].includes(token)) {
      index += 1;
      continue;
    }
    if (/^--data(?:-raw|-binary)?=/.test(token)) continue;
    next.push(token);
  }
  return next;
}

function readLastResponseHeader(headers: string, name: string) {
  const blocks = headers.trim().split(/\r?\n\r?\n/);
  const lastBlock = blocks.at(-1) ?? "";
  const prefix = `${name.toLowerCase()}:`;
  const line = lastBlock.split(/\r?\n/).find((candidate) => candidate.toLowerCase().startsWith(prefix));
  return line?.slice(line.indexOf(":") + 1).trim() ?? null;
}

function redactResponseHeaders(headers: string, exactOrigin: string) {
  return headers.split(/\r?\n/).map((line) => {
    const separator = line.indexOf(":");
    if (separator <= 0) return line;
    const name = line.slice(0, separator);
    if (
      [
        "set-cookie",
        "authorization",
        "proxy-authorization",
        "x-api-key",
        "x-auth-token",
      ].includes(name.toLowerCase())
    ) return `${name}: [redacted]`;
    if (name.toLowerCase() === "location") {
      try {
        const location = new URL(line.slice(separator + 1).trim(), exactOrigin);
        if (location.origin !== exactOrigin) return `${name}: [cross-origin redacted]`;
        const safeLocation = `${location.origin}${location.pathname}${location.search ? "?[redacted]" : ""}${location.hash ? "#[redacted]" : ""}`;
        return `${name}: ${safeLocation}`;
      } catch {
        return `${name}: [invalid redacted]`;
      }
    }
    return line;
  }).join("\n").trim();
}

function isRedirectStatus(status: number) {
  return [301, 302, 303, 307, 308].includes(status);
}

function formatSafeUrl(value: string) {
  try {
    const url = new URL(value);
    return `${url.origin}${url.pathname}${url.search ? "?[redacted]" : ""}${url.hash ? "#[redacted]" : ""}`;
  } catch {
    return "[invalid URL]";
  }
}

function removeResponseFiles(headerPath: string, bodyPath: string) {
  rmSync(headerPath, { force: true });
  rmSync(bodyPath, { force: true });
}
