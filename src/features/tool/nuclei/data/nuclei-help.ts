import { ToolHelpContent } from "../../shared/types/tool-screen.types";
import { NucleiFieldId } from "../types/nuclei.types";

export const nucleiHelpContent: Record<NucleiFieldId, ToolHelpContent> = {
  target: {
    title: "Target",
    summary: "The URL you want Nuclei to scan for template matches.",
    commandEffect: "Adds -u followed by the active target.",
    guidance:
      "Use a single URL for the guided flow. Target lists can still be run by editing the command manually.",
  },
  severityPreset: {
    title: "Severity",
    summary: "Limits templates by Nuclei severity using a simple preset.",
    commandEffect:
      "Adds -severity for medium+, high+, or critical. All leaves severity unfiltered.",
    guidance:
      "Start with all for broad coverage, then narrow to high+ or critical when you need a focused run.",
  },
  tags: {
    title: "Tags",
    summary: "Filters templates by comma-separated Nuclei tags.",
    commandEffect: "Adds -tags followed by your comma-separated list.",
    guidance:
      "Examples: cve,rce or exposure,misconfig. Leave empty to avoid tag filtering.",
  },
  templatesPath: {
    title: "Templates path",
    summary: "Runs templates from a specific file or directory path.",
    commandEffect: "Adds -t followed by the path when provided.",
    guidance:
      "NullTrace does not validate or manage templates here; Nuclei will report path errors in output.",
  },
  extraArgs: {
    title: "Extra args",
    summary: "Lets you append raw Nuclei flags beyond the guided controls.",
    commandEffect: "Appends your text directly at the end of the command.",
    guidance:
      "Good for one-off flags like rate limits, proxy settings, or headers before dedicated controls exist.",
  },
};
