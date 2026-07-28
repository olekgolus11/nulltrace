import { readFfufArtifactResult } from "../../tool/ffuf/services/ffuf-output.helpers";
import { FfufArtifactResult } from "../../tool/ffuf/types/ffuf.types";
import { TargetSitemapDiscoveryProvenance } from "../model/sitemap.types";

export function readFfufArtifactResults(payload: unknown): FfufArtifactResult[] {
  if (!payload || typeof payload !== "object" || Array.isArray(payload)) {
    return [];
  }

  const results = (payload as Record<string, unknown>).results;
  return Array.isArray(results)
    ? results.flatMap((result) => {
        const parsed = readFfufArtifactResult(result);
        return parsed ? [parsed] : [];
      })
    : [];
}

export function readFfufArtifactProvenance(
  payload: unknown,
): Exclude<TargetSitemapDiscoveryProvenance, "both"> {
  if (!payload || typeof payload !== "object" || Array.isArray(payload)) {
    return "public";
  }
  const runContext = (payload as Record<string, unknown>).runContext;
  if (!runContext || typeof runContext !== "object" || Array.isArray(runContext)) {
    return "public";
  }
  return (runContext as Record<string, unknown>).provenance === "authenticated"
    ? "authenticated"
    : "public";
}
