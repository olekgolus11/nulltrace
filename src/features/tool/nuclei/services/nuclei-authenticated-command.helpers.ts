import { tokenizeShellCommand } from "./nuclei-shell.helpers";

const authenticatedIncompatibleFlags = new Set([
  "debug",
  "dreq",
  "debug-req",
  "dresp",
  "debug-resp",
  "sresp",
  "store-resp",
  "srd",
  "store-resp-dir",
  "irr",
  "include-rr",
  "trace-log",
  "tlog",
  "H",
  "header",
  "V",
  "var",
  "sf",
  "secret-file",
  "fr",
  "follow-redirects",
  "fhr",
  "follow-host-redirects",
  "l",
  "list",
  "targets-inline",
  "resume",
  "t",
  "templates",
  "it",
  "include-templates",
  "turl",
  "template-url",
  "w",
  "workflows",
  "wurl",
  "workflow-url",
  "ai",
  "prompt",
  "code",
  "esc",
  "enable-self-contained",
  "file",
  "o",
  "output",
  "j",
  "json",
  "jsonl",
  "jle",
  "jsonl-export",
  "je",
  "json-export",
  "me",
  "markdown-export",
  "se",
  "sarif-export",
  "pe",
  "pdf-export",
  "rdb",
  "report-db",
]);

export function validateAuthenticatedNucleiCommand(command: string) {
  const tokens = tokenizeShellCommand(command);
  const targets: string[] = [];
  const proxyUrls: string[] = [];

  if (tokens[0] !== "nuclei") {
    throw new Error("Authenticated Nuclei runs require the nuclei executable directly.");
  }

  tokens.forEach((token, index) => {
    const flag = parseCommandFlag(token);
    if (!flag) {
      return;
    }
    if (authenticatedIncompatibleFlags.has(flag.name)) {
      throw new Error(
        "Authenticated Nuclei runs cannot use options that expose raw requests or responses, enable redirects, accept multiple targets, or supply authorization values directly.",
      );
    }
    if (flag.name === "omit-raw" || flag.name === "or") {
      const value = flag.inlineValue ?? tokens[index + 1] ?? "";
      if (value.toLowerCase() === "false") {
        throw new Error(
          "Authenticated Nuclei runs cannot disable raw request or response omission.",
        );
      }
    }
    if (flag.name === "u" || flag.name === "target") {
      const target = flag.inlineValue ?? tokens[index + 1] ?? "";
      if (target) {
        targets.push(target);
      }
    }
    if (flag.name === "p" || flag.name === "proxy" || flag.name === "proxy-internal") {
      const proxyUrl = flag.inlineValue ?? tokens[index + 1] ?? "";
      if (proxyUrl) {
        proxyUrls.push(proxyUrl);
      }
    }
  });

  const [target] = targets;
  if (targets.length !== 1 || !target || target.includes(",") || target.includes("\n")) {
    throw new Error("Authenticated Nuclei runs require exactly one explicit HTTP or HTTPS target.");
  }
  assertUrlHasNoCredentials(target);
  proxyUrls.forEach(assertUrlHasNoCredentials);
  return target;
}

function assertUrlHasNoCredentials(value: string) {
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    return;
  }
  if (url.username || url.password) {
    throw new Error("Authenticated Nuclei runs cannot supply authorization values in URLs.");
  }
}

function parseCommandFlag(token: string) {
  if (!token.startsWith("-") || token === "-") {
    return null;
  }
  const separatorIndex = token.indexOf("=");
  const rawName = separatorIndex === -1 ? token : token.slice(0, separatorIndex);
  return {
    name: rawName.replace(/^-+/, ""),
    inlineValue: separatorIndex === -1 ? null : token.slice(separatorIndex + 1),
  };
}
