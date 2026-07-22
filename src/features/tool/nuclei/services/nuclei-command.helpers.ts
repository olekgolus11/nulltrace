import { ParsedNucleiJsonl, NucleiRawFinding } from "./nuclei-command.types";
import { shellTokenPattern, tokenizeShellCommand } from "./nuclei-shell.helpers";

const nucleiOutputFlagPattern = new RegExp(
  String.raw`\s+(?:(?:-jsonl|-json|-j|-sresp|-store-resp)(?=\s|$)|(?:-o|-output|-jle|-jsonl-export|-je|-json-export|-me|-markdown-export|-se|-sarif-export|-rdb|-report-db|-srd|-store-resp-dir)(?:\s+${shellTokenPattern}))`,
  "g",
);
const nucleiNoColorFlagPattern = /(?:^|\s)-(?:nc|no-color)(?=\s|$)/;
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
]);

export function stripNucleiOutputFlags(command: string) {
  return command.replace(nucleiOutputFlagPattern, " ");
}

export function hasNucleiNoColorFlag(command: string) {
  return nucleiNoColorFlagPattern.test(command);
}

export function validateAuthenticatedNucleiCommand(command: string) {
  const tokens = tokenizeShellCommand(command);
  const targets: string[] = [];

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
  });

  const [target] = targets;
  if (targets.length !== 1 || !target || target.includes(",") || target.includes("\n")) {
    throw new Error("Authenticated Nuclei runs require exactly one explicit HTTP or HTTPS target.");
  }
  return target;
}

export function parseNucleiJsonl(content: string): ParsedNucleiJsonl {
  return content.split(/\r?\n/).reduce<ParsedNucleiJsonl>(
    (result, line) => {
      const trimmedLine = line.trim();
      if (!trimmedLine) {
        return result;
      }

      try {
        const raw = JSON.parse(trimmedLine) as unknown;
        const finding = getObject(raw);
        if (!finding) {
          return {
            ...result,
            parseErrorCount: result.parseErrorCount + 1,
          };
        }

        const info = getObject(finding.info);
        result.findings.push({
          templateId: getString(finding["template-id"]),
          name: getFirstString(info?.name, finding["template-id"]),
          severity: getString(info?.severity),
          matchedAt: getFirstString(finding["matched-at"], finding.host),
          type: getString(finding.type),
          tags: getStringArray(info?.tags),
          description: getString(info?.description),
          references: getStringArray(info?.reference),
          raw: finding,
        });
        return result;
      } catch {
        return {
          ...result,
          parseErrorCount: result.parseErrorCount + 1,
        };
      }
    },
    {
      findings: [],
      parseErrorCount: 0,
    },
  );
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

function getString(value: unknown): string | null {
  return typeof value === "string" && value.trim() ? value : null;
}

function getObject(value: unknown): NucleiRawFinding | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return null;
  }

  return value as NucleiRawFinding;
}

function getStringArray(value: unknown): string[] {
  if (Array.isArray(value)) {
    return value.filter((item): item is string => typeof item === "string");
  }

  if (typeof value === "string" && value.trim()) {
    return value
      .split(",")
      .map((item) => item.trim())
      .filter(Boolean);
  }

  return [];
}

function getFirstString(...values: unknown[]): string | null {
  for (const value of values) {
    const stringValue = getString(value);
    if (stringValue) {
      return stringValue;
    }
  }

  return null;
}
