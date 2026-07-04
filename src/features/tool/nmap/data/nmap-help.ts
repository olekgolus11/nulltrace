import type { ToolHelpContent } from "../../shared/types/tool-screen.types";
import type { NmapFieldId } from "../types/nmap.types";

export const nmapHelpContent: Record<NmapFieldId, ToolHelpContent> = {
  target: {
    title: "Target",
    summary: "The host or network you want Nmap to scan.",
    commandEffect: "Appends the target at the end of the command.",
    guidance:
      "Use a hostname, IP, or CIDR range. Keep it narrow while testing.",
  },
  ports: {
    title: "Ports",
    summary: "Limits the scan to specific ports instead of the default set.",
    commandEffect: "Adds -p followed by your comma-separated list or range.",
    guidance:
      "Examples: 80,443,8080 or 1-1000. Leave empty for the default behavior.",
  },
  timing: {
    title: "Timing",
    summary: "Controls how fast and noisy the scan runs.",
    commandEffect: "Adds one timing template flag such as -T3 or -T4.",
    guidance:
      "T2 is quieter, T3 is balanced, and T4-T5 are faster but easier to notice.",
  },
  serviceDetection: {
    title: "Service/version detection",
    summary: "Probes open ports to identify service banners and versions.",
    commandEffect: "Adds -sV unless aggressive mode is enabled.",
    guidance:
      "Useful after finding open ports, especially when you need product versions.",
  },
  osDetection: {
    title: "OS detection",
    summary: "Attempts to fingerprint the target operating system.",
    commandEffect: "Adds -O unless aggressive mode is enabled.",
    guidance:
      "Works best when the target exposes enough network traits for fingerprinting.",
  },
  defaultScripts: {
    title: "Default scripts",
    summary: "Runs Nmap's default NSE script set against discovered services.",
    commandEffect: "Adds -sC unless aggressive mode is enabled.",
    guidance:
      "Great for safe enumeration, but it is still more intrusive than a plain port scan.",
  },
  aggressive: {
    title: "Aggressive profile",
    summary:
      "Bundles service detection, OS detection, scripts, and traceroute.",
    commandEffect:
      "Adds -A and overrides the individual service, OS, and script flags in this builder.",
    guidance:
      "Use it when you want a broader sweep quickly, but expect it to be noisier and slower.",
  },
  extraArgs: {
    title: "Extra args",
    summary: "Lets you append raw Nmap flags beyond the guided controls.",
    commandEffect: "Appends your text directly before the target.",
    guidance:
      "Good for one-off flags like --open or --reason. Avoid repeating flags already set above.",
  },
};
