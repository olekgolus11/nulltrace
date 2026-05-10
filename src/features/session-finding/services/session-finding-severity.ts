const canonicalSeverities = [
  "info",
  "low",
  "medium",
  "high",
  "critical",
] as const;

export type CanonicalSessionFindingSeverity =
  (typeof canonicalSeverities)[number];

const severityLookup = canonicalSeverities.reduce<
  Record<string, CanonicalSessionFindingSeverity>
>((accumulator, severity) => {
  accumulator[severity] = severity;
  return accumulator;
}, {});

export function normalizeSessionFindingSeverity(
  severity: string | null | undefined,
): CanonicalSessionFindingSeverity {
  if (!severity) {
    return "info";
  }

  return severityLookup[severity.trim().toLowerCase()] ?? "info";
}
