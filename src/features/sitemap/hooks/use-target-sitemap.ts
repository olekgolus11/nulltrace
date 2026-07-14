import { useEffect, useMemo, useState } from "react";
import { buildTree, flattenTree } from "../model/sitemap.utils";
import { filterTargetSitemapEntries } from "../model/sitemap-read-model";
import {
  AuthenticatedSitemapAccessObservationRecord,
  AuthenticatedSitemapCrawlStatusRecord,
  TargetSitemapCrawlStatusRecord,
  TargetSitemapEntryRecord,
  TargetSitemapProvenanceFilter,
} from "../model/sitemap.types";
import { sitemapRepository } from "../services/sitemap.repository";

interface TargetSitemapState {
  entries: TargetSitemapEntryRecord[];
  status: TargetSitemapCrawlStatusRecord | null;
  authenticatedStatus: AuthenticatedSitemapCrawlStatusRecord | null;
  accessObservations: AuthenticatedSitemapAccessObservationRecord[];
}

function readTargetSitemap(
  targetId: string,
  sessionId: string | null,
): TargetSitemapState {
  const result = sitemapRepository.listEntries({
    targetId,
    limit: 500,
  });

  return {
    entries: result.entries,
    status: sitemapRepository.getCrawlStatus(targetId),
    authenticatedStatus: sessionId
      ? sitemapRepository.getAuthenticatedCrawlStatus(sessionId, targetId)
      : null,
    accessObservations: sessionId
      ? sitemapRepository.listAccessObservations(sessionId)
      : [],
  };
}

const provenanceFilters: TargetSitemapProvenanceFilter[] = [
  "all",
  "public",
  "authenticated",
  "both",
];

export function useTargetSitemap(
  targetId: string | null,
  sessionId: string | null,
) {
  const [maxDepth, setMaxDepth] = useState<number | null>(null);
  const [provenanceFilter, setProvenanceFilter] =
    useState<TargetSitemapProvenanceFilter>("all");
  const [state, setState] = useState<TargetSitemapState>({
    entries: [],
    status: null,
    authenticatedStatus: null,
    accessObservations: [],
  });

  useEffect(() => {
    setMaxDepth(null);
    setProvenanceFilter("all");

    if (!targetId) {
      setState({
        entries: [],
        status: null,
        authenticatedStatus: null,
        accessObservations: [],
      });
      return;
    }

    const refresh = () => {
      setState(readTargetSitemap(targetId, sessionId));
    };

    refresh();
    const interval = setInterval(refresh, 1000);

    return () => clearInterval(interval);
  }, [sessionId, targetId]);

  const availableMaxDepth = useMemo(
    () => Math.max(0, ...state.entries.map((entry) => entry.depth)),
    [state.entries],
  );
  const visibleEntries = useMemo(
    () => filterTargetSitemapEntries(state.entries, maxDepth, provenanceFilter),
    [maxDepth, provenanceFilter, state.entries],
  );

  const observationByEntryId = useMemo(
    () =>
      new Map(
        state.accessObservations.map((observation) => [
          observation.entryId,
          observation,
        ]),
      ),
    [state.accessObservations],
  );

  const nodes = useMemo(
    () =>
      buildTree(
        visibleEntries.map((entry) => ({
          path: entry.path,
          status: entry.httpStatus ?? 0,
          method: entry.method ?? undefined,
          entryId: entry.id,
          normalizedUrl: entry.normalizedUrl,
          provenance: entry.provenance,
          source: entry.source,
          accessObservation: observationByEntryId.get(entry.id),
        })),
      ),
    [observationByEntryId, visibleEntries],
  );
  const flatNodes = useMemo(() => flattenTree(nodes), [nodes]);
  const entryNodes = useMemo(
    () => flatNodes.filter((node) => node.entryId),
    [flatNodes],
  );

  const cycleMaxDepth = (direction: -1 | 1) => {
    setMaxDepth((currentDepth) => {
      const currentIndex =
        currentDepth === null ? availableMaxDepth + 1 : currentDepth;
      const nextIndex = Math.max(
        0,
        Math.min(availableMaxDepth + 1, currentIndex + direction),
      );

      return nextIndex > availableMaxDepth ? null : nextIndex;
    });
  };

  const cycleProvenance = (direction: -1 | 1) => {
    setProvenanceFilter((current) => {
      const currentIndex = provenanceFilters.indexOf(current);
      const nextIndex =
        (currentIndex + direction + provenanceFilters.length) %
        provenanceFilters.length;
      return provenanceFilters[nextIndex]!;
    });
  };

  return {
    entries: state.entries,
    visibleEntries,
    nodes,
    flatNodes,
    entryNodes,
    status: state.status,
    authenticatedStatus: state.authenticatedStatus,
    maxDepth,
    provenanceFilter,
    cycleMaxDepth,
    cycleProvenance,
  };
}
