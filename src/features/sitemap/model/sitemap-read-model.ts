import {
  TargetSitemapEntryRecord,
  TargetSitemapProvenanceFilter,
} from "./sitemap.types";

export function filterTargetSitemapEntries(
  entries: TargetSitemapEntryRecord[],
  maxDepth: number | null,
  provenance: TargetSitemapProvenanceFilter,
) {
  return entries.filter((entry) => {
    const matchesDepth = maxDepth === null || entry.depth <= maxDepth;
    const matchesProvenance =
      provenance === "all" || entry.provenance === provenance;
    return matchesDepth && matchesProvenance;
  });
}
