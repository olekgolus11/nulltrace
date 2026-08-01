import { SqlmapToolData } from "../../tool/sqlmap/types/sqlmap.types";
import { getActionDraftStringField } from "./action-draft-payload.helpers";

export function mapSqlmapActionDraftFormState(
  toolData: SqlmapToolData,
  formState: Record<string, unknown> | null,
) {
  if (!formState) return { toolData, didApply: false };
  const form = { ...toolData.form };
  let didApply = false;

  (["targetUrl", "parameter", "body", "timeLimitSeconds", "extraSafeOptions"] as const).forEach(
    (field) => {
      const value = getActionDraftStringField(formState, field);
      if (value !== undefined) {
        form[field] = value;
        didApply = true;
      }
    },
  );
  const method = getActionDraftStringField(formState, "method")?.toUpperCase();
  if (method === "GET" || method === "POST") {
    form.method = method;
    didApply = true;
  }
  const level = getActionDraftStringField(formState, "level");
  if (level && ["1", "2", "3"].includes(level)) {
    form.level = level;
    didApply = true;
  }
  const risk = getActionDraftStringField(formState, "risk");
  if (risk === "1") {
    form.risk = risk;
    didApply = true;
  }

  return {
    toolData: { ...toolData, selectedField: 0, form },
    didApply,
  };
}
