import { NucleiRawFinding, ParsedNucleiJsonl } from "./nuclei-finding-jsonl.types";

export function parseNucleiJsonl(content: string): ParsedNucleiJsonl {
  return content.split(/\r?\n/).reduce<ParsedNucleiJsonl>(
    (result, line) => {
      const trimmedLine = line.trim();
      if (!trimmedLine) {
        return result;
      }

      try {
        const raw = JSON.parse(trimmedLine) as unknown;
        const finding = getObject(raw);
        if (!finding) {
          return {
            ...result,
            parseErrorCount: result.parseErrorCount + 1,
          };
        }

        const info = getObject(finding.info);
        result.findings.push({
          templateId: getString(finding["template-id"]),
          name: getFirstString(info?.name, finding["template-id"]),
          severity: getString(info?.severity),
          matchedAt: getFirstString(finding["matched-at"], finding.host),
          type: getString(finding.type),
          tags: getStringArray(info?.tags),
          description: getString(info?.description),
          references: getStringArray(info?.reference),
          raw: finding,
        });
        return result;
      } catch {
        return {
          ...result,
          parseErrorCount: result.parseErrorCount + 1,
        };
      }
    },
    {
      findings: [],
      parseErrorCount: 0,
    },
  );
}

function getString(value: unknown): string | null {
  return typeof value === "string" && value.trim() ? value : null;
}

function getObject(value: unknown): NucleiRawFinding | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return null;
  }

  return value as NucleiRawFinding;
}

function getStringArray(value: unknown): string[] {
  if (Array.isArray(value)) {
    return value.filter((item): item is string => typeof item === "string");
  }

  if (typeof value === "string" && value.trim()) {
    return value
      .split(",")
      .map((item) => item.trim())
      .filter(Boolean);
  }

  return [];
}

function getFirstString(...values: unknown[]): string | null {
  for (const value of values) {
    const stringValue = getString(value);
    if (stringValue) {
      return stringValue;
    }
  }

  return null;
}
