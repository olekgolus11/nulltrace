import { FindingCandidate, FindingMapper } from "../../model/finding.types";
import { ToolRunArtifactRecord } from "../../../session/model/session.repository.types";
import { normalizeFindingSeverity } from "../finding-severity";

interface NucleiFindingsPayload {
  findings?: unknown[];
}

interface NucleiArtifactFinding {
  templateId?: string | null;
  name?: string | null;
  severity?: string | null;
  matchedAt?: string | null;
  type?: string | null;
  tags?: string[];
  description?: string | null;
  references?: string[];
  raw?: Record<string, unknown>;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function asArray<T>(value: T[] | undefined): T[] {
  return Array.isArray(value) ? value : [];
}

function normalizeText(value: string | null | undefined) {
  return value?.trim() || null;
}

function normalizeToken(value: string | null | undefined) {
  const normalized = normalizeText(value)?.toLowerCase();

  if (!normalized) {
    return null;
  }

  return normalized.replace(/[^a-z0-9._-]+/g, "_").replace(/^_+|_+$/g, "");
}

function getString(value: unknown): string | null {
  return typeof value === "string" && value.trim() ? value : null;
}

function getNumberLikeString(value: unknown): string | null {
  if (typeof value === "number" && Number.isFinite(value)) {
    return String(value);
  }

  return getString(value);
}

function parseNucleiFindingsPayload(
  payload: unknown,
): NucleiFindingsPayload | null {
  if (!isRecord(payload)) {
    return null;
  }

  return payload as NucleiFindingsPayload;
}

function getFindingTarget(finding: NucleiArtifactFinding) {
  return (
    normalizeText(finding.matchedAt) ??
    getString(finding.raw?.["matched-at"]) ??
    getString(finding.raw?.host) ??
    getString(finding.raw?.url) ??
    "unknown-target"
  );
}

function getFindingTitle(finding: NucleiArtifactFinding, target: string) {
  return (
    normalizeText(finding.name) ??
    normalizeText(finding.templateId) ??
    `Nuclei finding on ${target}`
  );
}

function getFindingSummary(finding: NucleiArtifactFinding, target: string) {
  const description = normalizeText(finding.description);
  const templateId = normalizeText(finding.templateId);
  const severity = normalizeToken(finding.severity);

  if (description) {
    return description;
  }

  if (templateId) {
    return `Nuclei reported ${templateId} on ${target}.`;
  }

  if (severity) {
    return `Nuclei reported a ${severity} finding on ${target}.`;
  }

  return `Nuclei reported a finding on ${target}.`;
}

function getFindingKind(finding: NucleiArtifactFinding) {
  const type = normalizeToken(finding.type);

  if (type) {
    return `nuclei.${type}`;
  }

  const tags = asArray(finding.tags).map((tag) => normalizeToken(tag));
  if (tags.includes("cve")) {
    return "nuclei.cve";
  }

  return "nuclei.finding";
}

function getStringArray(values: string[] | undefined) {
  return asArray(values)
    .map((value) => normalizeText(value))
    .filter((value): value is string => Boolean(value));
}

function getRawContext(raw: Record<string, unknown> | undefined) {
  if (!raw) {
    return {};
  }

  return {
    matcherName: getString(raw["matcher-name"]),
    extractorName: getString(raw["extractor-name"]),
    host: getString(raw.host),
    ip: getString(raw.ip),
    port: getNumberLikeString(raw.port),
    scheme: getString(raw.scheme),
  };
}

function createNucleiFinding(
  finding: NucleiArtifactFinding,
  findingIndex: number,
): FindingCandidate {
  const target = getFindingTarget(finding);
  const templateId = normalizeText(finding.templateId);
  const name = normalizeText(finding.name);
  const tags = getStringArray(finding.tags);
  const references = getStringArray(finding.references);
  const rawContext = getRawContext(finding.raw);

  return {
    sourceTool: "nuclei",
    kind: getFindingKind(finding),
    severity: normalizeFindingSeverity(finding.severity),
    title: getFindingTitle(finding, target),
    summary: getFindingSummary(finding, target),
    target,
    dedupeKeyParts: [
      templateId ?? name ?? "unknown-template",
      target,
      rawContext.matcherName ?? "",
      rawContext.extractorName ?? "",
    ],
    payload: {
      artifactFindingIndex: findingIndex,
      artifactItemPath: `$.findings[${findingIndex}]`,
      templateId,
      matchedAt: normalizeText(finding.matchedAt),
      type: normalizeText(finding.type),
      sourceSeverity: normalizeText(finding.severity),
      tags,
      description: normalizeText(finding.description),
      references,
      ...rawContext,
    },
  };
}

export const nucleiFindingMapper: FindingMapper = {
  artifactType: "nuclei_findings",
  mapArtifact(artifact: ToolRunArtifactRecord) {
    const payload = parseNucleiFindingsPayload(artifact.payload);

    if (!payload) {
      return [];
    }

    return asArray(payload.findings).flatMap((finding, findingIndex) => {
      if (!isRecord(finding)) {
        return [];
      }

      return [createNucleiFinding(finding, findingIndex)];
    });
  },
};
