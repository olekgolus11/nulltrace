import { nmapTimingOptions } from "../../tool/nmap/config/nmap.config";
import { NmapToolData } from "../../tool/nmap/types/nmap.types";
import {
  getActionDraftBooleanField,
  getActionDraftStringField,
} from "./action-draft-payload.helpers";

export function mapNmapActionDraftFormState(
  toolData: NmapToolData,
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

  (["target", "ports", "extraArgs"] as const).forEach((field) => {
    const value = getActionDraftStringField(formState, field);
    if (value !== undefined) {
      form[field] = value;
      didApply = true;
    }
  });

  const timing = getActionDraftStringField(formState, "timing");
  if (timing && nmapTimingOptions.includes(timing as typeof form.timing)) {
    form.timing = timing as typeof form.timing;
    didApply = true;
  }

  (["serviceDetection", "osDetection", "defaultScripts", "aggressive"] as const).forEach(
    (field) => {
      const value = getActionDraftBooleanField(formState, field);
      if (value !== undefined) {
        form[field] = value;
        didApply = true;
      }
    },
  );

  return {
    toolData: {
      ...toolData,
      selectedField: 0,
      form,
    },
    didApply,
  };
}
