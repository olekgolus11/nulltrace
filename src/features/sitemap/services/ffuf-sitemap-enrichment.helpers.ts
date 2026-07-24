import { readFfufArtifactResult } from "../../tool/ffuf/services/ffuf-output.helpers";
import { FfufArtifactResult } from "../../tool/ffuf/types/ffuf.types";

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
