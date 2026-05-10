const canonicalSeverities = [
  "info",
  "low",
  "medium",
  "high",
  "critical",
] as const;

export type CanonicalFindingSeverity = (typeof canonicalSeverities)[number];

const severityLookup = canonicalSeverities.reduce<
  Record<string, CanonicalFindingSeverity>
>((accumulator, severity) => {
  accumulator[severity] = severity;
  return accumulator;
}, {});

export function normalizeFindingSeverity(
  severity: string | null | undefined,
): CanonicalFindingSeverity {
  if (!severity) {
    return "info";
  }

  return severityLookup[severity.trim().toLowerCase()] ?? "info";
}
