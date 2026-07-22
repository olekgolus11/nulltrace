import {
  AuthenticatedSitemapAccessObservationRecord,
  TargetSitemapEntryRecord,
  TargetSitemapProvenanceFilter,
} from "./sitemap.types";

export function getTargetSitemapEntryDisplayStatus(
  entry: TargetSitemapEntryRecord,
  accessObservation?: AuthenticatedSitemapAccessObservationRecord,
) {
  return entry.httpStatus ?? accessObservation?.httpStatus ?? 0;
}

export function filterTargetSitemapEntries(
  entries: TargetSitemapEntryRecord[],
  maxDepth: number | null,
  provenance: TargetSitemapProvenanceFilter,
) {
  return entries.filter((entry) => {
    const matchesDepth = maxDepth === null || entry.depth <= maxDepth;
    const matchesProvenance = provenance === "all" || entry.provenance === provenance;
    return matchesDepth && matchesProvenance;
  });
}
