const valueOptions = new Set([
  "-u",
  "--url",
  "--method",
  "--data",
  "-p",
  "--test-parameter",
  "--level",
  "--risk",
  "--timeout",
  "--retries",
  "--threads",
  "--technique",
  "--dbms",
  "--string",
  "--not-string",
  "--regexp",
  "--code",
  "--skip",
]);

const switchOptions = new Set([
  "--batch",
  "--disable-coloring",
  "--smart",
  "--text-only",
  "--titles",
  "--parse-errors",
]);

interface ParsedOption {
  name: string;
  value: string | null;
}

interface ValidatedSqlmapCommand {
  options: ParsedOption[];
  method: "GET" | "POST";
  parameter: string;
  targetUrl: string;
}

export function quoteSqlmapShellValue(value: string) {
  return `'${value.replaceAll("'", "'\\''")}'`;
}

export function validateTargetedSqlmapCommand(command: string): ValidatedSqlmapCommand {
  const tokens = parseSqlmapShellWords(command);
  if (tokens[0]?.toLowerCase() !== "sqlmap") {
    throw new Error("sqlmap workspace only runs sqlmap commands.");
  }

  const options = parseOptions(tokens.slice(1));
  const targetOptions = options.filter(
    (option) => option.name === "-u" || option.name === "--url",
  );
  const parameterOptions = options.filter(
    (option) => option.name === "-p" || option.name === "--test-parameter",
  );
  if (targetOptions.length !== 1) {
    throw new Error("Targeted sqlmap verification requires exactly one URL target.");
  }
  if (parameterOptions.length !== 1) {
    throw new Error("Targeted sqlmap verification requires exactly one test parameter.");
  }

  const targetUrl = targetOptions[0]?.value ?? "";
  const parameter = parameterOptions[0]?.value?.trim() ?? "";
  if (!parameter || parameter.includes(",") || /\s/.test(parameter)) {
    throw new Error("Targeted sqlmap verification requires one parameter name.");
  }

  let parsedTarget: URL;
  try {
    parsedTarget = new URL(targetUrl);
  } catch {
    throw new Error("Targeted sqlmap verification requires a valid HTTP target URL.");
  }
  if (
    !["http:", "https:"].includes(parsedTarget.protocol) ||
    parsedTarget.username ||
    parsedTarget.password ||
    targetUrl.includes("*")
  ) {
    throw new Error("Targeted sqlmap verification requires one credential-free HTTP endpoint.");
  }

  const methodOption = getSingleOption(options, "--method");
  const method = (methodOption?.value ?? "GET").toUpperCase();
  if (method !== "GET" && method !== "POST") {
    throw new Error("Targeted sqlmap verification supports GET and POST only.");
  }
  const dataOption = getSingleOption(options, "--data");
  if (method === "GET" && dataOption) {
    throw new Error("Targeted sqlmap GET verification rejects request bodies.");
  }
  if (method === "POST" && !dataOption?.value) {
    throw new Error("Targeted sqlmap POST verification requires a body.");
  }
  const hasParameter =
    method === "GET"
      ? parsedTarget.searchParams.has(parameter)
      : bodyContainsParameter(dataOption?.value ?? "", parameter);
  if (!hasParameter) {
    throw new Error(
      `Targeted sqlmap verification parameter ${parameter} is absent from the selected request.`,
    );
  }

  const level = Number.parseInt(getSingleOption(options, "--level")?.value ?? "1", 10);
  if (level < 1 || level > 3) {
    throw new Error("Targeted sqlmap verification level must be between 1 and 3.");
  }
  const risk = Number.parseInt(getSingleOption(options, "--risk")?.value ?? "1", 10);
  if (risk !== 1) {
    throw new Error("Targeted sqlmap verification risk must be 1.");
  }
  assertIntegerBound(options, "--timeout", 1, 30);
  assertIntegerBound(options, "--retries", 0, 2);
  assertIntegerBound(options, "--threads", 1, 2);

  const technique = getSingleOption(options, "--technique")?.value?.toUpperCase();
  if (technique && (!/^[BEU]+$/.test(technique) || new Set(technique).size !== technique.length)) {
    throw new Error("Targeted sqlmap verification allows B, E, and U techniques only.");
  }

  return {
    options,
    method,
    parameter,
    targetUrl: parsedTarget.toString(),
  };
}

export function hasSqlmapOption(command: string, optionName: string) {
  return validateTargetedSqlmapCommand(command).options.some(
    (option) => option.name === optionName,
  );
}

function parseOptions(tokens: string[]) {
  const options: ParsedOption[] = [];
  for (let index = 0; index < tokens.length; index += 1) {
    const token = tokens[index]!;
    if (!token.startsWith("-")) {
      throw new Error("Targeted sqlmap verification rejects positional values.");
    }
    const separatorIndex = token.indexOf("=");
    const name = separatorIndex >= 0 ? token.slice(0, separatorIndex).toLowerCase() : token.toLowerCase();
    const inlineValue = separatorIndex >= 0 ? token.slice(separatorIndex + 1) : null;
    if (!valueOptions.has(name) && !switchOptions.has(name)) {
      throw new Error(`Targeted sqlmap verification rejects option ${name}.`);
    }
    if (switchOptions.has(name)) {
      if (inlineValue !== null) {
        throw new Error(`Targeted sqlmap verification rejects value for option ${name}.`);
      }
      options.push({ name, value: null });
      continue;
    }
    const value = inlineValue ?? tokens[index + 1];
    if (value === undefined || (inlineValue === null && value.startsWith("-"))) {
      throw new Error(`Targeted sqlmap verification requires a value for option ${name}.`);
    }
    if (inlineValue === null) index += 1;
    options.push({ name, value });
  }

  const uniqueNames = new Set<string>();
  options.forEach((option) => {
    const canonicalName =
      option.name === "-u"
        ? "--url"
        : option.name === "-p"
          ? "--test-parameter"
          : option.name;
    if (uniqueNames.has(canonicalName)) {
      throw new Error(`Targeted sqlmap verification rejects repeated option ${canonicalName}.`);
    }
    uniqueNames.add(canonicalName);
  });
  return options;
}

function getSingleOption(options: ParsedOption[], name: string) {
  return options.find((option) => option.name === name);
}

function assertIntegerBound(
  options: ParsedOption[],
  optionName: string,
  minimum: number,
  maximum: number,
) {
  const option = getSingleOption(options, optionName);
  if (!option) return;
  const value = Number(option.value);
  if (!Number.isInteger(value) || value < minimum || value > maximum) {
    throw new Error(
      `Targeted sqlmap verification ${optionName} must be between ${minimum} and ${maximum}.`,
    );
  }
}

function bodyContainsParameter(body: string, parameter: string) {
  if (new URLSearchParams(body).has(parameter)) return true;
  try {
    return jsonContainsKey(JSON.parse(body), parameter);
  } catch {
    return false;
  }
}

function jsonContainsKey(value: unknown, parameter: string): boolean {
  if (Array.isArray(value)) return value.some((entry) => jsonContainsKey(entry, parameter));
  if (!value || typeof value !== "object") return false;
  const record = value as Record<string, unknown>;
  return parameter in record || Object.values(record).some((entry) => jsonContainsKey(entry, parameter));
}

function parseSqlmapShellWords(command: string) {
  const tokens: string[] = [];
  let token = "";
  let hasToken = false;
  let quote: "'" | '"' | null = null;

  for (let index = 0; index < command.length; index += 1) {
    const character = command[index]!;
    if (quote === "'") {
      if (character === "'") quote = null;
      else token += character;
      continue;
    }
    if (quote === '"') {
      if (character === '"') quote = null;
      else if (character === "$" || character === "`") {
        throw new Error("Targeted sqlmap verification rejects shell expansion.");
      } else if (character === "\\") {
        const next = command[index + 1];
        if (!next) throw new Error("Targeted sqlmap verification rejects unterminated escapes.");
        token += next;
        index += 1;
      } else token += character;
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
      if (!next) throw new Error("Targeted sqlmap verification rejects unterminated escapes.");
      token += next;
      hasToken = true;
      index += 1;
      continue;
    }
    if ("#;&|`$<>\n\r(){}".includes(character)) {
      throw new Error("Targeted sqlmap verification rejects shell expansion and composed commands.");
    }
    token += character;
    hasToken = true;
  }
  if (quote) throw new Error("Targeted sqlmap verification rejects unterminated quotes.");
  if (hasToken) tokens.push(token);
  return tokens;
}

export function getFirstSqlmapQueryParameter(targetUrl: string) {
  try {
    return new URL(targetUrl).searchParams.keys().next().value ?? "";
  } catch {
    return "";
  }
}

export function normalizeSqlmapMethod(value: string): "GET" | "POST" {
  return value.toUpperCase() === "POST" ? "POST" : "GET";
}

export function normalizeSqlmapLevel(value: string) {
  const parsed = Number.parseInt(value, 10);
  return String(Math.max(1, Math.min(Number.isFinite(parsed) ? parsed : 1, 3)));
}

export function normalizeSqlmapTimeLimit(
  value: string | undefined,
  minimum: number,
  defaultValue: number,
  maximum: number,
) {
  const parsed = Number.parseInt(value ?? "", 10);
  return Math.max(
    minimum,
    Math.min(Number.isFinite(parsed) ? parsed : defaultValue, maximum),
  );
}
