import { redactNucleiCommandForPersistence } from "../../tool/nuclei/services/nuclei-command-redaction.helpers";

export function redactActionDraftAuthorizationValues(
  value: unknown,
  redactString: (content: string) => string = redactNucleiCommandForPersistence,
): unknown {
  if (typeof value === "string") {
    return redactString(value);
  }
  if (Array.isArray(value)) {
    return value.map((entry) =>
      redactActionDraftAuthorizationValues(entry, redactString),
    );
  }
  if (!value || typeof value !== "object") {
    return value;
  }
  return Object.fromEntries(
    Object.entries(value).map(([key, entryValue]) => [
      key,
      /authorization|cookie|header|password|secret|token/i.test(key)
        ? "[redacted]"
        : redactActionDraftAuthorizationValues(entryValue, redactString),
    ]),
  );
}
