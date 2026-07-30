import { NiktoToolData } from "../../tool/nikto/types/nikto.types";
import { getActionDraftStringField } from "./action-draft-payload.helpers";

export function mapNiktoActionDraftFormState(
  toolData: NiktoToolData,
  formState: Record<string, unknown> | null,
) {
  if (!formState) return { toolData, didApply: false };
  let didApply = false;
  const form = { ...toolData.form };
  (["target", "rootPath", "vhost", "timeoutSeconds"] as const).forEach((field) => {
    const value = getActionDraftStringField(formState, field);
    if (value !== undefined) {
      form[field] = value;
      didApply = true;
    }
  });
  const profile = getActionDraftStringField(formState, "profile");
  if (profile === "standard") didApply = true;

  return {
    toolData: { ...toolData, selectedField: 0, form: { ...form, profile: "standard" as const } },
    didApply,
  };
}
