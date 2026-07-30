import {
  SessionReportFinding,
  SessionReportSourceContextField,
} from "../model/session-report.types";
import { redactSessionReportText } from "./session-report-redaction.helpers";

const sourceContextFieldLimit = 12;
const sourceContextValueLimit = 160;
const sourceContextTotalLimit = 1_200;
const sourceContextReferenceLimit = 3;

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function normalizeValue(value: unknown) {
  if (typeof value === "number" && Number.isFinite(value)) {
    return String(value);
  }

  if (typeof value !== "string" || !value.trim()) {
    return null;
  }

  return redactSessionReportText(value).replace(/\s+/g, " ").trim();
}

function truncateValue(value: string) {
  if (value.length <= sourceContextValueLimit) {
    return value;
  }

  return `${value.slice(0, sourceContextValueLimit - 3)}...`;
}

function addField(
  fields: SessionReportSourceContextField[],
  label: string,
  value: unknown,
) {
  const normalized = normalizeValue(value);

  if (!normalized) {
    return;
  }

  fields.push({
    label,
    value: truncateValue(normalized),
  });
}

function addArrayField(
  fields: SessionReportSourceContextField[],
  label: string,
  value: unknown,
) {
  if (!Array.isArray(value)) {
    return;
  }

  const items = value
    .map(normalizeValue)
    .filter((item): item is string => item !== null);

  if (items.length === 0) {
    return;
  }

  addField(fields, label, items.join(", "));
}

function addReferenceField(fields: SessionReportSourceContextField[], value: unknown) {
  if (!Array.isArray(value)) {
    return;
  }

  const references = value
    .map(normalizeValue)
    .filter((item): item is string => item !== null);
  const visibleReferences = references.slice(0, sourceContextReferenceLimit);

  if (visibleReferences.length === 0) {
    return;
  }

  const hiddenCount = references.length - visibleReferences.length;
  addField(
    fields,
    "References",
    `${visibleReferences.join(", ")}${hiddenCount > 0 ? `, +${hiddenCount} more` : ""}`,
  );
}

function createNucleiFields(payload: Record<string, unknown>) {
  const fields: SessionReportSourceContextField[] = [];

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

function createNmapFields(payload: Record<string, unknown>) {
  const fields: SessionReportSourceContextField[] = [];
  const service = isRecord(payload.service) ? payload.service : null;

  addField(fields, "Artifact Path", payload.artifactItemPath);
  addField(fields, "Host", payload.host);
  addField(fields, "Protocol", payload.protocol);
  addField(fields, "Port", payload.port);
  addField(fields, "State", payload.state);
  addField(fields, "Reason", payload.reason);
  addField(fields, "Service Name", service?.name);
  addField(fields, "Product", service?.product);
  addField(fields, "Version", service?.version);
  addField(fields, "Extra Info", service?.extraInfo);
  addField(fields, "OS Type", service?.osType);
  addArrayField(fields, "CPEs", service?.cpes);
  addField(fields, "Script ID", payload.scriptId);
  addField(fields, "Script Output", payload.output);

  return fields;
}

function createFfufFields(payload: Record<string, unknown>) {
  const fields: SessionReportSourceContextField[] = [];

  addField(fields, "Artifact Index", payload.artifactResultIndex);
  addField(fields, "Artifact Path", payload.artifactItemPath);
  addField(fields, "Parameter", payload.parameterName);
  addField(fields, "Request Location", payload.requestLocation);
  addField(fields, "Anomaly", payload.anomalyKind);
  addField(fields, "Response Status", payload.responseStatus);
  addField(fields, "Response Size", payload.responseSize);
  addField(fields, "Response Words", payload.responseWords);
  addField(fields, "Response Lines", payload.responseLines);
  addField(fields, "Redirect Location", payload.redirectLocation);

  return fields;
}

function boundFields(fields: SessionReportSourceContextField[]) {
  let totalLength = 0;

  return fields.slice(0, sourceContextFieldLimit).flatMap((field) => {
    const remainingLength = sourceContextTotalLimit - totalLength - field.label.length;

    if (remainingLength <= 0) {
      return [];
    }

    const value =
      field.value.length <= remainingLength
        ? field.value
        : `${field.value.slice(0, Math.max(0, remainingLength - 3))}...`;
    totalLength += field.label.length + value.length;

    return [{ ...field, value }];
  });
}

export function createSessionReportSourceContext(
  finding: SessionReportFinding,
): SessionReportSourceContextField[] {
  if (!isRecord(finding.payload)) {
    return [];
  }

  const fields =
    finding.sourceTool === "nuclei" || finding.kind.startsWith("nuclei.")
      ? createNucleiFields(finding.payload)
      : finding.sourceTool === "nmap" || finding.kind.startsWith("nmap.")
        ? createNmapFields(finding.payload)
        : finding.sourceTool === "ffuf" || finding.kind.startsWith("ffuf.")
          ? createFfufFields(finding.payload)
          : [];

  return boundFields(fields);
}
