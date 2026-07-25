export function readPageInspectionAuthenticationSelections(): Record<string, number> {
  if (!process.env.OPENCODE_CONFIG_CONTENT) {
    return {};
  }

  try {
    const value: unknown = JSON.parse(
      process.env.NULLTRACE_PAGE_INSPECTION_AUTH_SELECTIONS ?? "{}",
    );
    if (!value || typeof value !== "object" || Array.isArray(value)) {
      return {};
    }
    return Object.fromEntries(
      Object.entries(value).filter(
        ([sessionId, authStateVersion]) =>
          typeof sessionId === "string" &&
          typeof authStateVersion === "number" &&
          Number.isInteger(authStateVersion) &&
          authStateVersion >= 0,
      ),
    );
  } catch {
    return {};
  }
}
