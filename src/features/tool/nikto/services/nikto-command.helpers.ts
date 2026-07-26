const prohibitedOptionPattern =
  /(?:^|\s)-(?:Tuning|mutate|mutate-options|evasion)(?:\s|=|$)/i;

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

export function assertNiktoStandardCommand(command: string) {
  assertNoShellComposition(command);
  if (prohibitedOptionPattern.test(command)) {
    throw new Error(
      "Nikto Standard rejects -Tuning, -mutate, -mutate-options, and -evasion.",
    );
  }
  if (!/^\s*nikto(?:\s|$)/i.test(command)) {
    throw new Error("Nikto workspace only runs nikto commands.");
  }
}

export function parseNiktoJsonReport(content: string) {
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

  const root = getRecord(parsed);
  const rawItems = Array.isArray(parsed)
    ? parsed
    : Array.isArray(root?.vulnerabilities)
      ? root.vulnerabilities
      : Array.isArray(root?.findings)
        ? root.findings
        : [];
  let rejectedItemCount = 0;
  const findings = rawItems.flatMap((item, index) => {
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
      url,
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

function assertNoShellComposition(command: string) {
  let quote: "'" | '"' | null = null;

  for (const character of command) {
    if (quote) {
      if (character === quote) quote = null;
      if (quote === '"' && (character === "$" || character === "`" || character === "\\")) {
        throw new Error("Nikto Standard rejects shell expansion and composed commands.");
      }
      continue;
    }
    if (character === "'" || character === '"') {
      quote = character;
      continue;
    }
    if (";&|`$<>\n\r(){}\\".includes(character)) {
      throw new Error("Nikto Standard rejects shell expansion and composed commands.");
    }
  }

  if (quote) {
    throw new Error("Nikto Standard rejects commands with unterminated quotes.");
  }
}
