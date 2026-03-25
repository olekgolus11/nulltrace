import { nmapBooleanFields, nmapTimingOptions } from "../config/nmap.config";
import {
  NmapFieldId,
  NmapFormState,
  NmapTiming,
  NmapToolData,
} from "../types/nmap.types";

class NmapCommandService {
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

  createInitialToolData(targetUrl: string): NmapToolData {
    return {
      selectedField: 0,
      form: {
        target: this.extractHostname(targetUrl),
        ports: "",
        timing: "T3",
        serviceDetection: true,
        osDetection: false,
        defaultScripts: false,
        aggressive: false,
        extraArgs: "",
      },
    };
  }

  buildCommand(toolData: NmapToolData) {
    const form = toolData.form;
    const cmd: string[] = ["nmap"];

    if (form.aggressive) {
      cmd.push("-A");
    } else {
      if (form.serviceDetection) {
        cmd.push("-sV");
      }
      if (form.osDetection) {
        cmd.push("-O");
      }
      if (form.defaultScripts) {
        cmd.push("-sC");
      }
    }

    cmd.push(`-${form.timing}`);

    if (form.ports.trim()) {
      cmd.push("-p", form.ports.trim());
    }

    if (form.extraArgs.trim()) {
      cmd.push(form.extraArgs.trim());
    }

    if (form.target.trim()) {
      cmd.push(form.target.trim());
    }

    return cmd.join(" ").trim();
  }

  setField(
    toolData: NmapToolData,
    field: keyof NmapFormState,
    value: string | boolean | NmapTiming,
  ): NmapToolData {
    return {
      ...toolData,
      form: {
        ...toolData.form,
        [field]: value,
      },
    };
  }

  moveSelection(
    toolData: NmapToolData,
    delta: -1 | 1,
    max: number,
  ): NmapToolData {
    return {
      ...toolData,
      selectedField: Math.max(0, Math.min(toolData.selectedField + delta, max)),
    };
  }

  toggleBooleanField(toolData: NmapToolData, field: NmapFieldId): NmapToolData {
    if (!nmapBooleanFields.includes(field)) {
      return toolData;
    }

    return {
      ...toolData,
      form: {
        ...toolData.form,
        [field]: !toolData.form[field],
      },
    };
  }

  cycleTiming(toolData: NmapToolData, delta: -1 | 1): NmapToolData {
    const currentIndex = nmapTimingOptions.indexOf(toolData.form.timing);
    const nextIndex =
      (currentIndex + delta + nmapTimingOptions.length) %
      nmapTimingOptions.length;

    return {
      ...toolData,
      form: {
        ...toolData.form,
        timing: nmapTimingOptions[nextIndex]!,
      },
    };
  }
}

export const nmapCommandService = new NmapCommandService();
