export function redactSqlmapPersistentText(
  content: string,
  protectedValues: string[] = [],
) {
  let redacted = content;
  protectedValues
    .filter((value) => value.length >= 8)
    .sort((left, right) => right.length - left.length)
    .forEach((value) => {
      redacted = redacted.replaceAll(value, "[redacted]");
    });
  return redacted
    .replace(
      /(^|[\s("'=])\/(?!\/)[^\s'")]+/g,
      "$1[local path redacted]",
    )
    .replace(
      /\b([A-Z][A-Z0-9_]*(?:TOKEN|SECRET|PASSWORD|PASS|API_KEY|PRIVATE_KEY))=[^\s]+/g,
      "$1=[redacted]",
    )
    .replace(
      /\b[A-Za-z]:\\(?:Users|Temp|Windows)\\[^\s'")]+/g,
      "[local path redacted]",
    );
}

export function redactSqlmapCommandForPersistence(
  command: string,
  protectedValues: string[] = [],
) {
  const redactedRequestBody = command.replace(
    /(--data(?:=|\s+))(?:"(?:\\.|[^"\\])*"|'(?:'\\''|[^'])*'|[^\s]+)/gi,
    "$1'[request body redacted]'",
  );
  return redactSqlmapPersistentText(redactedRequestBody, protectedValues);
}

export function redactSqlmapOutput(
  content: string,
  controlledDirectory: string,
  protectedValues: string[] = [],
) {
  return redactSqlmapPersistentText(
    content.replaceAll(controlledDirectory, "[controlled sqlmap output]"),
    protectedValues,
  );
}

export function getSensitiveSqlmapEnvironmentValues() {
  return Object.entries(process.env).flatMap(([key, value]) =>
    /TOKEN|SECRET|PASSWORD|PASS|API_KEY|PRIVATE_KEY/i.test(key) && value ? [value] : [],
  );
}
