export const shellTokenPattern = String.raw`(?:'[^']*'|"(?:\\.|[^"])*"|\S+)`;

export function shellQuote(value: string) {
  return `'${value.split("'").join("'\\''")}'`;
}

export function assertSimpleShellCommand(command: string) {
  let quote: "'" | '"' | null = null;
  let isEscaped = false;

  for (const character of command) {
    if (isEscaped) {
      isEscaped = false;
      continue;
    }
    if (character === "\\" && quote !== "'") {
      isEscaped = true;
      continue;
    }
    if (quote) {
      if (character === quote) {
        quote = null;
      } else if (character === "$" || character === "`") {
        throw new Error(
          "Authenticated Nuclei runs cannot use shell expansion or control syntax.",
        );
      }
      continue;
    }
    if (character === "'" || character === '"') {
      quote = character;
      continue;
    }
    if (
      character === "$" ||
      character === "`" ||
      character === ";" ||
      character === "|" ||
      character === "&" ||
      character === "<" ||
      character === ">" ||
      character === "(" ||
      character === ")" ||
      character === "{" ||
      character === "}" ||
      character === "*" ||
      character === "?" ||
      character === "[" ||
      character === "]" ||
      character === "#" ||
      character === "\n" ||
      character === "\r"
    ) {
      throw new Error(
        "Authenticated Nuclei runs cannot use shell expansion or control syntax.",
      );
    }
  }
}

export function tokenizeShellCommand(command: string) {
  assertSimpleShellCommand(command);
  const tokens: string[] = [];
  let token = "";
  let quote: "'" | '"' | null = null;
  let isEscaped = false;

  const finishToken = () => {
    if (!token) {
      return;
    }
    tokens.push(token);
    token = "";
  };

  for (const character of command) {
    if (isEscaped) {
      token += character;
      isEscaped = false;
      continue;
    }
    if (character === "\\" && quote !== "'") {
      isEscaped = true;
      continue;
    }
    if (quote) {
      if (character === quote) {
        quote = null;
      } else {
        token += character;
      }
      continue;
    }
    if (character === "'" || character === '"') {
      quote = character;
      continue;
    }
    if (/\s/.test(character)) {
      finishToken();
      continue;
    }
    token += character;
  }

  if (quote || isEscaped) {
    throw new Error("Authenticated Nuclei command contains invalid shell quoting.");
  }
  finishToken();
  return tokens;
}
