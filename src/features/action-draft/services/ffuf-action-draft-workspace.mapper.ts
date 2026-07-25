import { FfufToolData } from "../../tool/ffuf/types/ffuf.types";
import {
  getActionDraftBooleanField,
  getActionDraftStringField,
} from "./action-draft-payload.helpers";

export function mapFfufActionDraftFormState(
  toolData: FfufToolData,
  formState: Record<string, unknown> | null,
) {
  if (!formState) {
    return {
      toolData,
      didApply: false,
    };
  }

  let didApply = false;
  const form = { ...toolData.form };
  (
    [
      "targetPattern",
      "wordlist",
      "extensions",
      "recursionDepth",
      "matchCodes",
      "filterCodes",
      "rate",
      "timeLimit",
    ] as const
  ).forEach((field) => {
    const value = getActionDraftStringField(formState, field);
    if (value !== undefined) {
      form[field] = value;
      didApply = true;
    }
  });

  const recursion = getActionDraftBooleanField(formState, "recursion");
  if (recursion !== undefined) {
    form.recursion = recursion;
    didApply = true;
  }

  return {
    toolData: { ...toolData, mode: "content_discovery", selectedField: 0, form },
    didApply,
  };
}
