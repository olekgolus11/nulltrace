import { SessionFindingRecord } from "../model/finding.types";

export interface FindingSourceContextField {
  label: string;
  value: string;
}

const FIELD_PREVIEW_LIMIT = 160;
const JSON_PREVIEW_LIMIT = 500;
const REFERENCE_PREVIEW_LIMIT = 3;

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function normalizeText(value: unknown) {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

function normalizeNumber(value: unknown) {
  return typeof value === "number" && Number.isFinite(value)
    ? String(value)
    : null;
}

function truncate(value: string, limit: number) {
  const normalized = value.replace(/\s+/g, " ").trim();

  if (normalized.length <= limit) {
    return normalized;
  }

  return `${normalized.slice(0, Math.max(0, limit - 3))}...`;
}

function compactJsonPreview(value: unknown) {
  const json = JSON.stringify(value);

  if (!json) {
    return String(value);
  }

  return truncate(json, JSON_PREVIEW_LIMIT);
}

function getString(value: unknown) {
  return normalizeText(value) ?? normalizeNumber(value);
}

function getStringArray(value: unknown) {
  if (!Array.isArray(value)) {
    return [];
  }

  return value
    .map((item) => getString(item))
    .filter((item): item is string => Boolean(item));
}

function addField(
  fields: FindingSourceContextField[],
  label: string,
  value: unknown,
  limit = FIELD_PREVIEW_LIMIT,
) {
  const text = getString(value);

  if (!text) {
    return;
  }

  fields.push({
    label,
    value: truncate(text, limit),
  });
}

function addArrayField(
  fields: FindingSourceContextField[],
  label: string,
  value: unknown,
  limit = FIELD_PREVIEW_LIMIT,
) {
  const items = getStringArray(value);

  if (items.length === 0) {
    return;
  }

  fields.push({
    label,
    value: truncate(items.join(", "), limit),
  });
}

function addReferenceField(
  fields: FindingSourceContextField[],
  value: unknown,
) {
  const references = getStringArray(value);

  if (references.length === 0) {
    return;
  }

  const visibleReferences = references.slice(0, REFERENCE_PREVIEW_LIMIT);
  const hiddenCount = references.length - visibleReferences.length;
  const suffix = hiddenCount > 0 ? `, +${hiddenCount} more` : "";

  fields.push({
    label: "References",
    value: truncate(
      `${visibleReferences.join(", ")}${suffix}`,
      FIELD_PREVIEW_LIMIT,
    ),
  });
}

function createNmapSourceContext(payload: Record<string, unknown>) {
  const fields: FindingSourceContextField[] = [];
  const service = isRecord(payload.service) ? payload.service : null;

  addField(fields, "Artifact Path", payload.artifactItemPath);
  addField(fields, "Host", payload.host);
  addField(fields, "Protocol", payload.protocol);
  addField(fields, "Port", payload.port);
  addField(fields, "State", payload.state);
  addField(fields, "Reason", payload.reason);

  if (service) {
    addField(fields, "Service Name", service.name);
    addField(fields, "Product", service.product);
    addField(fields, "Version", service.version);
    addField(fields, "Extra Info", service.extraInfo);
    addField(fields, "OS Type", service.osType);
    addField(fields, "Detection Method", service.method);
    addField(fields, "Confidence", service.confidence);
    addArrayField(fields, "CPEs", service.cpes);
  }

  addField(fields, "Script ID", payload.scriptId);
  addField(fields, "Script Output", payload.output);

  return fields;
}

function createNucleiSourceContext(payload: Record<string, unknown>) {
  const fields: FindingSourceContextField[] = [];

  addField(fields, "Artifact Index", payload.artifactFindingIndex);
  addField(fields, "Artifact Path", payload.artifactItemPath);
  addField(fields, "Template ID", payload.templateId);
  addField(fields, "Matched Target", payload.matchedAt);
  addField(fields, "Type", payload.type);
  addArrayField(fields, "Tags", payload.tags);
  addField(fields, "Source Severity", payload.sourceSeverity);
  addField(fields, "Description", payload.description);
  addReferenceField(fields, payload.references);
  addField(fields, "Matcher", payload.matcherName);
  addField(fields, "Extractor", payload.extractorName);
  addField(fields, "Host", payload.host);
  addField(fields, "IP", payload.ip);
  addField(fields, "Port", payload.port);
  addField(fields, "Scheme", payload.scheme);

  return fields;
}

function createFallbackSourceContext(payload: unknown) {
  return [
    {
      label: "JSON Preview",
      value: compactJsonPreview(payload),
    },
  ];
}

export function createFindingSourceContextFields(
  finding: Pick<SessionFindingRecord, "sourceTool" | "kind" | "payload">,
): FindingSourceContextField[] {
  if (!isRecord(finding.payload)) {
    return createFallbackSourceContext(finding.payload);
  }

  const fields =
    finding.sourceTool === "nmap" || finding.kind.startsWith("nmap.")
      ? createNmapSourceContext(finding.payload)
      : finding.sourceTool === "nuclei" || finding.kind.startsWith("nuclei.")
        ? createNucleiSourceContext(finding.payload)
        : [];

  return fields.length > 0
    ? fields
    : createFallbackSourceContext(finding.payload);
}
