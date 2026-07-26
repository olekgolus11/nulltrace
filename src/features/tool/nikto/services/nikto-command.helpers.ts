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
      url: getNiktoFindingUrl(url, host),
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

function getNiktoFindingUrl(url: string, host: Record<string, unknown> | null) {
  if (/^https?:\/\//i.test(url) || !host) return url;
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
