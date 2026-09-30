import { AuthenticatedRequestContext } from "../../authentication/model/authenticated-request-context.types";
import { splitAuthenticatedCookieEntries, splitAuthenticatedHeaderEntries } from "../../authentication/services/authenticated-request-context-redaction";
import { ExecutionPlan } from "../types/execution-plan.types";

const authenticatedCurlProfile = {
  profileId: "authenticated-curl-worker-v1",
  tool: "curl",
  mode: "authenticated-worker",
  executableId: "bun",
  argv: ["run", "/opt/nulltrace/workers/curl-worker.ts"],
  configSlot: { id: "curl-config", kind: "data", maximumBytes: 2 * 1024 * 1024 },
  secretSlot: { id: "curl-auth-context", kind: "secret", maximumBytes: 64 * 1024 },
} as const;

export function matchesSanitizedAuthenticatedCurlPlan(plan: ExecutionPlan): boolean {
  return plan.profileId === authenticatedCurlProfile.profileId && plan.tool === authenticatedCurlProfile.tool &&
    plan.mode === authenticatedCurlProfile.mode && plan.invocation.executableId === authenticatedCurlProfile.executableId &&
    plan.invocation.argv.length === authenticatedCurlProfile.argv.length &&
    plan.invocation.argv.every((argument, index) => argument === authenticatedCurlProfile.argv[index]) &&
    plan.origins.length === 1 && plan.inputs.length === 2 &&
    plan.inputs[0]?.id === authenticatedCurlProfile.configSlot.id &&
    plan.inputs[0]?.kind === authenticatedCurlProfile.configSlot.kind &&
    plan.inputs[0]?.maximumBytes === authenticatedCurlProfile.configSlot.maximumBytes &&
    plan.inputs[1]?.id === authenticatedCurlProfile.secretSlot.id &&
    plan.inputs[1]?.kind === authenticatedCurlProfile.secretSlot.kind &&
    plan.inputs[1]?.maximumBytes === authenticatedCurlProfile.secretSlot.maximumBytes;
}

export function parseSanitizedAuthenticatedContext(bytes: Uint8Array, origin: string): AuthenticatedRequestContext | null {
  try {
    if (bytes.byteLength > 64 * 1024) return null;
    const source = new TextDecoder("utf-8", { fatal: true }).decode(bytes);
    const value: unknown = JSON.parse(source);
    if (!value || typeof value !== "object" || Array.isArray(value)) return null;
    const record = value as Record<string, unknown>;
    if (Object.keys(record).length !== 2 || typeof record.cookies !== "string" || typeof record.headers !== "string" ||
      hasDuplicateTopLevelKeys(source) || !isExactHttpOrigin(origin)) return null;

    const cookies = splitAuthenticatedCookieEntries(record.cookies);
    const headers = splitAuthenticatedHeaderEntries(record.headers);
    if (cookies.length + headers.length === 0 || cookies.length + headers.length > 512 ||
      Buffer.byteLength(record.cookies) + Buffer.byteLength(record.headers) > 64 * 1024 ||
      cookies.some((cookie) => {
        const separator = cookie.indexOf("=");
        return separator <= 0 || !/^[!#$%&'*+.^_`|~0-9A-Za-z-]+$/.test(cookie.slice(0, separator)) ||
          Buffer.byteLength(cookie) > 16 * 1024 || /[\u0000-\u001f\u007f]/.test(cookie);
      }) || headers.some((header) => {
        const separator = header.indexOf(":");
        const name = header.slice(0, separator).trim();
        const value = header.slice(separator + 1).trim();
        return separator <= 0 || !/^[!#$%&'*+.^_`|~0-9A-Za-z-]+$/.test(name) || !value ||
          Buffer.byteLength(header) > 16 * 1024 || /[\u0000-\u001f\u007f]/.test(value);
      })) return null;
    return { origin, cookies: record.cookies, headers: record.headers, updatedAt: "" };
  } catch {
    return null;
  }
}

export function stripExecutionTerminalControls(value: string): string {
  let result = "";
  let state: "text" | "escape" | "csi" | "osc" | "osc_escape" = "text";
  for (const character of value) {
    if (state === "escape") {
      state = character === "[" ? "csi" : character === "]" ? "osc" : "text";
      continue;
    }
    if (state === "csi") {
      const code = character.codePointAt(0)!;
      if (code >= 0x40 && code <= 0x7e) state = "text";
      continue;
    }
    if (state === "osc") {
      if (character === "\u0007") state = "text";
      else if (character === "\u001b") state = "osc_escape";
      continue;
    }
    if (state === "osc_escape") {
      state = character === "\\" ? "text" : "osc";
      continue;
    }
    if (character === "\u001b") {
      state = "escape";
      continue;
    }
    const code = character.codePointAt(0)!;
    if ((code < 32 && character !== "\n" && character !== "\r") ||
      (code >= 127 && code <= 159) || (code >= 0x202a && code <= 0x202e) ||
      (code >= 0x2066 && code <= 0x2069)) continue;
    result += character;
  }
  return state === "text" ? result : "";
}

export function isBoundedSanitizedOutput(
  streams: Readonly<Record<"stdout" | "stderr", string>>,
  maximumBytes: number,
): boolean {
  let totalBytes = 0;
  let totalLines = 0;
  for (const stream of ["stdout", "stderr"] as const) {
    const content = streams[stream];
    if (typeof content !== "string") return false;
    totalBytes += Buffer.byteLength(content);
    if (totalBytes > Math.min(maximumBytes, 1024 * 1024)) return false;
    for (const character of content) {
      const code = character.codePointAt(0)!;
      if (code >= 0xd800 && code <= 0xdfff) return false;
      if ((code < 32 && character !== "\n" && character !== "\r") || (code >= 127 && code <= 159) ||
        (code >= 0x202a && code <= 0x202e) || (code >= 0x2066 && code <= 0x2069)) return false;
    }
    for (const character of content) {
      if (character !== "\r" && character !== "\n") continue;
      totalLines += 1;
      if (totalLines > 2_000) return false;
    }
    if (content.length > 0 && !/[\r\n]$/.test(content)) totalLines += 1;
    if (totalLines > 2_000) return false;
    const lines = content.split(/[\r\n]/);
    for (const line of lines) {
      const bytes = Buffer.byteLength(line);
      if (bytes > 4_096) return false;
    }
  }
  return true;
}

function isExactHttpOrigin(value: string): boolean {
  try {
    const url = new URL(value);
    return (url.protocol === "http:" || url.protocol === "https:") && url.origin === value &&
      !url.username && !url.password && url.pathname === "/" && !url.search && !url.hash;
  } catch {
    return false;
  }
}

function hasDuplicateTopLevelKeys(source: string): boolean {
  const object = /^\s*\{([\s\S]*)\}\s*$/.exec(source)?.[1];
  if (object === undefined) return true;
  const keyMatches = [...object.matchAll(/(?:^|,)\s*"((?:[^"\\]|\\.)*)"\s*:/g)].map((match) => match[1]);
  return keyMatches.length !== 2 || new Set(keyMatches).size !== 2 || !keyMatches.includes("cookies") || !keyMatches.includes("headers");
}
