import { niktoCustomTuning } from "../config/nikto.config";
import { NiktoProfile, NiktoTuningCode } from "../types/nikto.types";

const prohibitedOptionNames = ["mutate", "mutate-options", "evasion"];
const allowedTuningCodes = new Set<string>(
  niktoCustomTuning.map(({ code }) => code),
);
const disruptiveTuningCodes = new Set<string>(
  niktoCustomTuning
    .filter(({ isDisruptive }) => isDisruptive)
    .map(({ code }) => code),
);

function getRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

function getString(record: Record<string, unknown>, keys: string[]) {
  for (const key of keys) {
    const value = record[key];
    if (typeof value === "string" && value.trim()) return value.trim();
    if (typeof value === "number" && Number.isFinite(value)) return String(value);
  }
  return null;
}

export function quoteNiktoShellValue(value: string) {
  return `'${value.replaceAll("'", "'\\''")}'`;
}

export function assertNiktoCommand(command: string, profile: NiktoProfile) {
  const tokens = parseNiktoShellWords(command);
  if (
    tokens.some((token) => {
      const normalized = token.toLowerCase();
      const option = normalized.split("=", 1)[0] ?? "";
      return isNiktoOptionAbbreviation(option, prohibitedOptionNames);
    })
  ) {
    throw new Error(
      "Nikto Standard rejects -mutate, -mutate-options, and -evasion; Custom rejects them too.",
    );
  }
  if (tokens[0]?.toLowerCase() !== "nikto") {
    throw new Error("Nikto workspace only runs nikto commands.");
  }

  const tuning = getNiktoCommandTuning(tokens);
  if (
    profile === "standard" &&
    (tuning.length !== 2 || tuning[0] !== "x" || tuning[1] !== "6")
  ) {
    throw new Error("Nikto Standard requires -Tuning x6 to exclude denial-of-service checks.");
  }
  if (profile === "custom" && tuning.some((code) => !allowedTuningCodes.has(code))) {
    throw new Error(
      "Nikto Custom accepts only documented guided tuning codes 2, 3, 6, and b.",
    );
  }
}

export function getNiktoTuningFromCommand(command: string): NiktoTuningCode[] {
  const codes = getNiktoCommandTuning(parseNiktoShellWords(command));
  return codes.filter((code): code is NiktoTuningCode => allowedTuningCodes.has(code));
}

export function isNiktoCommandDisruptive(command: string) {
  return getNiktoCommandTuning(parseNiktoShellWords(command)).some((code) =>
    disruptiveTuningCodes.has(code),
  );
}

export function parseNiktoJsonReport(content: string, requestedTarget?: string) {
  let parsed: unknown;
  try {
    parsed = JSON.parse(content);
  } catch (error) {
    return {
      findings: [],
      rejectedItemCount: 0,
      parseWarning: error instanceof Error ? error.message : "Invalid Nikto JSON report.",
    };
  }

  const reportItems = getNiktoReportItems(parsed);
  let rejectedItemCount = 0;
  const findings = reportItems.flatMap(({ item, host }, index) => {
    const record = getRecord(item);
    if (!record) {
      rejectedItemCount += 1;
      return [];
    }
    const message = getString(record, ["msg", "message", "description"]);
    const url = getString(record, ["url", "uri"]);
    if (!message || !url) {
      rejectedItemCount += 1;
      return [];
    }

    return [{
      id: getString(record, ["id", "OSVDB", "osvdb"]),
      method: getString(record, ["method"]),
      url: getNiktoFindingUrl(url, host, requestedTarget),
      message,
      severity: getString(record, ["severity"]),
      itemIndex: index,
    }];
  });

  return {
    findings,
    rejectedItemCount,
    parseWarning: rejectedItemCount
      ? `Nikto report skipped ${rejectedItemCount} malformed item(s).`
      : null,
  };
}

function getNiktoReportItems(parsed: unknown) {
  const root = getRecord(parsed);
  if (!Array.isArray(parsed)) {
    return getHostReportItems(root);
  }

  const hasHostReports = parsed.some((item) => {
    const record = getRecord(item);
    return Array.isArray(record?.vulnerabilities) || Array.isArray(record?.findings);
  });
  if (!hasHostReports) {
    return parsed.map((item) => ({ item, host: null }));
  }

  return parsed.flatMap((item) => getHostReportItems(getRecord(item)));
}

function getHostReportItems(host: Record<string, unknown> | null) {
  const items = Array.isArray(host?.vulnerabilities)
    ? host.vulnerabilities
    : Array.isArray(host?.findings)
      ? host.findings
      : [];
  return items.map((item) => ({ item, host }));
}

function getNiktoFindingUrl(
  url: string,
  host: Record<string, unknown> | null,
  requestedTarget?: string,
) {
  if (/^https?:\/\//i.test(url)) return url;
  if (requestedTarget) {
    try {
      return new URL(url, new URL(requestedTarget).origin).toString();
    } catch {
      // Fall back to scanner report host metadata.
    }
  }
  if (!host) return url;
  const hostname = getString(host, ["host", "hostname", "ip"]);
  if (!hostname) return url;
  const port = getString(host, ["port"]);
  const scheme = port === "443" ? "https" : "http";
  const authority = port && !["80", "443"].includes(port) ? `${hostname}:${port}` : hostname;

  try {
    return new URL(url, `${scheme}://${authority}`).toString();
  } catch {
    return url;
  }
}

function parseNiktoShellWords(command: string) {
  const tokens: string[] = [];
  let token = "";
  let hasToken = false;
  let quote: "'" | '"' | null = null;

  for (let index = 0; index < command.length; index += 1) {
    const character = command[index]!;
    if (quote === "'") {
      if (character === "'") {
        quote = null;
      } else {
        token += character;
      }
      continue;
    }
    if (quote === '"') {
      if (character === '"') {
        quote = null;
      } else if (character === "$" || character === "`") {
        throw new Error("Nikto Standard rejects shell expansion and composed commands.");
      } else if (character === "\\") {
        const next = command[index + 1];
        if (!next) {
          throw new Error("Nikto Standard rejects commands with unterminated escapes.");
        }
        token += next;
        index += 1;
      } else {
        token += character;
      }
      continue;
    }
    if (character === "'" || character === '"') {
      quote = character;
      hasToken = true;
      continue;
    }
    if (/\s/.test(character)) {
      if (hasToken) {
        tokens.push(token);
        token = "";
        hasToken = false;
      }
      continue;
    }
    if (character === "\\") {
      const next = command[index + 1];
      if (!next) {
        throw new Error("Nikto Standard rejects commands with unterminated escapes.");
      }
      token += next;
      hasToken = true;
      index += 1;
      continue;
    }
    if ("#;&|`$<>\n\r(){}".includes(character)) {
      throw new Error("Nikto Standard rejects shell expansion and composed commands.");
    }
    token += character;
    hasToken = true;
  }

  if (quote) {
    throw new Error("Nikto Standard rejects commands with unterminated quotes.");
  }
  if (hasToken) tokens.push(token);

  return tokens;
}

function getNiktoCommandTuning(tokens: string[]) {
  const tuning: string[] = [];
  let hasTuningOption = false;
  for (let index = 1; index < tokens.length; index += 1) {
    const token = tokens[index]!.toLowerCase();
    const equalsIndex = token.indexOf("=");
    const option = equalsIndex >= 0 ? token.slice(0, equalsIndex) : token;
    if (!isNiktoOptionAbbreviation(option, ["tuning"]) && option !== "-t") {
      continue;
    }
    if (hasTuningOption) {
      throw new Error("Nikto accepts exactly one tuning option per run.");
    }
    hasTuningOption = true;
    const value = equalsIndex >= 0 ? token.slice(equalsIndex + 1) : tokens[index + 1];
    if (!value) {
      throw new Error("Nikto tuning requires at least one guided tuning code.");
    }
    tuning.push(...value.toLowerCase());
    if (equalsIndex < 0) {
      index += 1;
    }
  }
  return tuning;
}

function isNiktoOptionAbbreviation(option: string, names: string[]) {
  const name = option.replace(/^(?:-{1,2}|\+)/, "");
  if (!name) return false;
  return names.some((candidate) => candidate.startsWith(name));
}
