import {
  nucleiFieldOrder,
  nucleiSeverityCliValues,
  nucleiSeverityOptions,
} from "../config/nuclei.config";
import {
  NucleiFieldId,
  NucleiFormState,
  NucleiSeverityPreset,
  NucleiToolData,
} from "../types/nuclei.types";

class NucleiCommandService {
  private extractHostname(targetUrl: string) {
    try {
      return new URL(targetUrl).hostname;
    } catch {
      return targetUrl
        .replace(/^https?:\/\//, "")
        .replace(/\/.*$/, "")
        .trim();
    }
  }

  createInitialToolData(targetUrl: string): NucleiToolData {
    return {
      selectedField: 0,
      form: {
        target: this.extractHostname(targetUrl),
        severityPreset: "all",
        tags: "",
        templatesPath: "",
        extraArgs: "",
      },
      future: {
        auth: {
          strategy: "none",
        },
        headers: {
          entries: [],
        },
        templateManagement: {
          source: "external",
        },
      },
    };
  }

  buildCommand(toolData: NucleiToolData) {
    const form = toolData.form;
    const cmd: string[] = ["nuclei"];

    if (form.target.trim()) {
      cmd.push("-u", form.target.trim());
    }

    if (form.severityPreset !== "all") {
      cmd.push("-severity", nucleiSeverityCliValues[form.severityPreset]);
    }

    if (form.tags.trim()) {
      cmd.push("-tags", form.tags.trim());
    }

    if (form.templatesPath.trim()) {
      cmd.push("-t", form.templatesPath.trim());
    }

    if (form.extraArgs.trim()) {
      cmd.push(form.extraArgs.trim());
    }

    return cmd.join(" ").trim();
  }

  setField(
    toolData: NucleiToolData,
    field: keyof NucleiFormState,
    value: string | NucleiSeverityPreset,
  ): NucleiToolData {
    return {
      ...toolData,
      form: {
        ...toolData.form,
        [field]: value,
      },
    };
  }

  moveSelection(
    toolData: NucleiToolData,
    delta: -1 | 1,
    max: number,
  ): NucleiToolData {
    return {
      ...toolData,
      selectedField: Math.max(0, Math.min(toolData.selectedField + delta, max)),
    };
  }

  cycleSeverity(toolData: NucleiToolData, delta: -1 | 1): NucleiToolData {
    const currentIndex = nucleiSeverityOptions.indexOf(
      toolData.form.severityPreset,
    );
    const nextIndex =
      (currentIndex + delta + nucleiSeverityOptions.length) %
      nucleiSeverityOptions.length;

    return {
      ...toolData,
      form: {
        ...toolData.form,
        severityPreset: nucleiSeverityOptions[nextIndex]!,
      },
    };
  }

  isSeverityFieldSelected(field: NucleiFieldId | undefined) {
    return field === "severityPreset";
  }

  getFieldCount() {
    return nucleiFieldOrder.length;
  }
}

export const nucleiCommandService = new NucleiCommandService();
