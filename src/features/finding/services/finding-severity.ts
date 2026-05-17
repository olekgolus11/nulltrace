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

const severityRank = canonicalSeverities.reduce<
  Record<CanonicalFindingSeverity, number>
>((accumulator, severity, index) => {
  accumulator[severity] = index;
  return accumulator;
}, {} as Record<CanonicalFindingSeverity, number>);

export function normalizeFindingSeverity(
  severity: string | null | undefined,
): CanonicalFindingSeverity {
  if (!severity) {
    return "info";
  }

  return severityLookup[severity.trim().toLowerCase()] ?? "info";
}

export function maxFindingSeverity(
  first: CanonicalFindingSeverity,
  second: CanonicalFindingSeverity,
) {
  return severityRank[first] >= severityRank[second] ? first : second;
}
