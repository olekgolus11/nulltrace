import { ToolRunArtifactRecord } from "../../../session/model/session.repository.types";
import { FindingMapper } from "../../model/finding.types";
import { normalizeFindingSeverity } from "../finding-severity";

export const niktoFindingMapper: FindingMapper = {
  artifactType: "nikto_report",
  mapArtifact(artifact: ToolRunArtifactRecord) {
    if (!isRecord(artifact.payload) || !Array.isArray(artifact.payload.findings)) return [];

    return artifact.payload.findings.flatMap((item, index) => {
      if (!isRecord(item)) return [];
      const message = text(item.message);
      const target = text(item.url);
      if (!message || !target) return [];
      const id = text(item.id);
      const method = text(item.method);

      return [{
        sourceTool: "nikto",
        kind: id ? "nikto.check" : "nikto.observation",
        severity: normalizeNiktoSeverity(text(item.severity)),
        title: id ? `Nikto ${id}: ${message}` : message,
        summary: message,
        target,
        dedupeKeyParts: [id ?? message, method ?? "", target],
        payload: {
          artifactFindingIndex: index,
          artifactItemPath: `$.findings[${index}]`,
          id,
          method,
          sourceSeverity: text(item.severity),
        },
      }];
    });
  },
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function text(value: unknown) {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

function normalizeNiktoSeverity(value: string | null) {
  const normalized = value?.toLowerCase();
  if (normalized === "warning") return "medium";
  if (normalized === "error") return "high";
  return normalizeFindingSeverity(normalized);
}
