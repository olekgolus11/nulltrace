import { shellTokenPattern } from "./nuclei-shell";
const nucleiSensitiveFlagPattern = new RegExp(
  String.raw`(^|\s)(--?(?:H|header|V|var))(?:=|\s+)${shellTokenPattern}`,
  "g",
);
const inlineAuthorizationPattern =
  /((?:authorization|cookie|proxy-authorization|x-api-key)\s*:\s*)(?:[^\s'";]+(?:\s+[^'";]+)?)/gi;

export function redactNucleiCommandForPersistence(command: string) {
  return command
    .replace(
      nucleiSensitiveFlagPattern,
      (_match, prefix: string, flag: string) =>
        `${prefix}${flag} '[redacted]'`,
    )
    .replace(inlineAuthorizationPattern, "$1[redacted]");
}
