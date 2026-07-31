import {
  isNiktoDirectAuthenticationOrConfigOption,
  parseNiktoShellWords,
} from "./nikto-command.helpers";

const urlUserInfoPattern = /\b([a-z][a-z0-9+.-]*:\/\/)[^@\s/]+@/gi;

export function validateAuthenticatedNiktoCommand(command: string) {
  const tokens = parseNiktoShellWords(command);
  const targets: string[] = [];
  const vhosts: string[] = [];

  for (let index = 1; index < tokens.length; index += 1) {
    const flag = parseCommandFlag(tokens[index]!);
    if (!flag) continue;
    if (isBlockedAuthenticatedOption(flag.name)) {
      throw new Error(
        "Authenticated Nikto runs cannot follow redirects or supply authentication and configuration options directly.",
      );
    }
    if (flag.name === "h" || flag.name === "host" || flag.name === "url") {
      const target = flag.inlineValue ?? tokens[index + 1] ?? "";
      if (target) targets.push(target);
      if (flag.inlineValue === null) index += 1;
    }
    if (flag.name.toLowerCase() === "vhost") {
      const vhost = flag.inlineValue ?? tokens[index + 1] ?? "";
      if (vhost) vhosts.push(vhost);
      if (flag.inlineValue === null) index += 1;
    }
  }

  const [target] = targets;
  if (targets.length !== 1 || !target || target.includes(",") || target.includes("\n")) {
    throw new Error(
      "Authenticated Nikto runs require exactly one explicit HTTP or HTTPS target.",
    );
  }

  let url: URL;
  try {
    url = new URL(target);
  } catch {
    throw new Error("Authenticated Nikto runs require a valid HTTP or HTTPS target.");
  }
  if (url.protocol !== "http:" && url.protocol !== "https:") {
    throw new Error("Authenticated Nikto runs require a valid HTTP or HTTPS target.");
  }
  if (url.username || url.password) {
    throw new Error("Authenticated Nikto runs cannot supply authorization values in URLs.");
  }
  if (
    vhosts.length > 1 ||
    (vhosts.length === 1 && vhosts[0]!.toLowerCase() !== url.host.toLowerCase())
  ) {
    throw new Error(
      "Authenticated Nikto vhost must match the target's exact authority.",
    );
  }
  return target;
}

export function redactNiktoCommandForPersistence(command: string) {
  let tokens: string[];
  try {
    tokens = parseNiktoShellWords(command);
  } catch {
    return "[redacted unsafe Nikto command]";
  }
  for (let index = 1; index < tokens.length; index += 1) {
    const flag = parseCommandFlag(tokens[index]!);
    if (!flag || !isNiktoDirectAuthenticationOrConfigOption(flag.name)) continue;
    return "[redacted] prohibited Nikto authentication/configuration command";
  }
  return command.replace(urlUserInfoPattern, "$1[redacted]@");
}

function isBlockedAuthenticatedOption(name: string) {
  const normalized = name.toLowerCase();
  return (
    isNiktoDirectAuthenticationOrConfigOption(normalized) ||
    ("followredirects".startsWith(normalized) && normalized.length >= 3)
  );
}

function parseCommandFlag(token: string) {
  if (!token.startsWith("-") || token === "-") return null;
  const separatorIndex = token.indexOf("=");
  const rawName = separatorIndex === -1 ? token : token.slice(0, separatorIndex);
  return {
    name: rawName.replace(/^-+/, ""),
    inlineValue: separatorIndex === -1 ? null : token.slice(separatorIndex + 1),
  };
}
