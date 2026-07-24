export function readPageInspectionAllowedSessionIds() {
  if (!process.env.OPENCODE_CONFIG_CONTENT) {
    return [];
  }

  try {
    const value: unknown = JSON.parse(process.env.NULLTRACE_PAGE_INSPECTION_SESSION_IDS ?? "[]");
    return Array.isArray(value)
      ? value.filter((sessionId): sessionId is string => typeof sessionId === "string")
      : [];
  } catch {
    return [];
  }
}
