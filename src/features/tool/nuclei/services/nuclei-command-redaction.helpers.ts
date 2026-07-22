import { shellTokenPattern } from "./nuclei-shell.helpers";

const nucleiUnquotedSensitiveHeaderPattern = new RegExp(
  String.raw`(^|\s)(--?(?:H|header))(?:=|\s+)(?:(?:authorization|cookie|proxy-authorization|x-api-key)\s*:\s*)[^\r\n]*?(?=\s+--?[A-Za-z][\w-]*(?:=|\s|$)|$)`,
  "gi",
);
const nucleiSensitiveFlagPattern = new RegExp(
  String.raw`(^|\s)(--?(?:H|header|V|var))(?:=|\s+)${shellTokenPattern}`,
  "g",
);
const inlineAuthorizationPattern =
  /((?:authorization|cookie|proxy-authorization|x-api-key)\s*:\s*)(?:[^\s'";]+(?:\s+[^'";]+)?)/gi;
const urlUserInfoPattern = /\b([a-z][a-z0-9+.-]*:\/\/)[^@\s/]+@/gi;

export function redactNucleiCommandForPersistence(command: string) {
  return command
    .replace(
      nucleiUnquotedSensitiveHeaderPattern,
      (_match, prefix: string, flag: string) => `${prefix}${flag} '[redacted]'`,
    )
    .replace(
      nucleiSensitiveFlagPattern,
      (_match, prefix: string, flag: string) => `${prefix}${flag} '[redacted]'`,
    )
    .replace(inlineAuthorizationPattern, "$1[redacted]")
    .replace(urlUserInfoPattern, "$1[redacted]@");
}
