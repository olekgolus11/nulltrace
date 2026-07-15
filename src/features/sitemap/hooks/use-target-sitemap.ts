import { useEffect, useMemo, useState } from "react";
import { buildTree, flattenTree } from "../model/sitemap.utils";
import {
  filterTargetSitemapEntries,
  getTargetSitemapEntryDisplayStatus,
} from "../model/sitemap-read-model";
import {
  AuthenticatedSitemapAccessObservationRecord,
  AuthenticatedSitemapCrawlStatusRecord,
  TargetSitemapCrawlStatusRecord,
  TargetSitemapEntryRecord,
  TargetSitemapProvenanceFilter,
  SitemapCrawlCheckpoint,
} from "../model/sitemap.types";
import { sitemapRepository } from "../services/sitemap.repository";
import {
  getSitemapCrawlControlPresentation,
  selectTransientCrawlFailures,
} from "../model/sitemap-crawl-lifecycle";
import { sitemapCrawlCoordinator } from "../services/sitemap-crawl-coordinator.instance";
import { authenticatedSitemapCrawlCoordinator } from "../services/authenticated-sitemap-crawl-coordinator.instance";

interface TargetSitemapState {
  entries: TargetSitemapEntryRecord[];
  status: TargetSitemapCrawlStatusRecord | null;
  authenticatedStatus: AuthenticatedSitemapCrawlStatusRecord | null;
  accessObservations: AuthenticatedSitemapAccessObservationRecord[];
  publicCheckpoint: SitemapCrawlCheckpoint | null;
  authenticatedCheckpoint: SitemapCrawlCheckpoint | null;
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
    publicCheckpoint: sitemapRepository.getCrawlCheckpoint("public", targetId),
    authenticatedCheckpoint: sessionId
      ? sitemapRepository.getCrawlCheckpoint("authenticated", sessionId)
      : null,
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
  targetUrl: string,
) {
  const [maxDepth, setMaxDepth] = useState<number | null>(null);
  const [provenanceFilter, setProvenanceFilter] =
    useState<TargetSitemapProvenanceFilter>("all");
  const [state, setState] = useState<TargetSitemapState>({
    entries: [],
    status: null,
    authenticatedStatus: null,
    accessObservations: [],
    publicCheckpoint: null,
    authenticatedCheckpoint: null,
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
        publicCheckpoint: null,
        authenticatedCheckpoint: null,
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
        visibleEntries.map((entry) => {
          const accessObservation = observationByEntryId.get(entry.id);
          return {
            path: entry.path,
            status: getTargetSitemapEntryDisplayStatus(
              entry,
              accessObservation,
            ),
            method: entry.method ?? undefined,
            entryId: entry.id,
            normalizedUrl: entry.normalizedUrl,
            provenance: entry.provenance,
            source: entry.source,
            accessObservation,
          };
        }),
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

  const controlPresentation = getSitemapCrawlControlPresentation(
    provenanceFilter,
    state.status?.status ?? "idle",
    state.authenticatedStatus?.status ?? "idle",
    selectTransientCrawlFailures(state.publicCheckpoint?.failures ?? []).length,
    selectTransientCrawlFailures(
      state.authenticatedCheckpoint?.failures ?? [],
    ).length,
  );

  const pauseOrResume = () => {
    if (!targetId || !controlPresentation.scope) {
      return;
    }
    if (controlPresentation.scope === "public") {
      if (controlPresentation.actions?.canPause) {
        sitemapCrawlCoordinator.pauseTargetCrawl(targetId);
      } else if (controlPresentation.actions?.canResume) {
        sitemapCrawlCoordinator.resumeTargetCrawl({ targetId, rootUrl: targetUrl });
      }
      return;
    }
    if (!sessionId) {
      return;
    }
    if (controlPresentation.actions?.canPause) {
      authenticatedSitemapCrawlCoordinator.pauseSessionCrawl(sessionId);
    } else if (controlPresentation.actions?.canResume) {
      void authenticatedSitemapCrawlCoordinator.resumePausedCrawl({
        sessionId,
        targetId,
        rootUrl: targetUrl,
      });
    }
  };

  const retryFailures = () => {
    if (!targetId || !controlPresentation.actions?.canRetryFailures) {
      return;
    }
    if (controlPresentation.scope === "public") {
      sitemapCrawlCoordinator.retryTargetFailures({ targetId, rootUrl: targetUrl });
    } else if (controlPresentation.scope === "authenticated" && sessionId) {
      void authenticatedSitemapCrawlCoordinator.retrySessionFailures({
        sessionId,
        targetId,
        rootUrl: targetUrl,
      });
    }
  };

  const restart = () => {
    if (!targetId || !controlPresentation.actions?.canRestart) {
      return;
    }
    if (controlPresentation.scope === "public") {
      sitemapCrawlCoordinator.restartTargetCrawl({ targetId, rootUrl: targetUrl });
    } else if (controlPresentation.scope === "authenticated" && sessionId) {
      void authenticatedSitemapCrawlCoordinator.restartSessionCrawl({
        sessionId,
        targetId,
        rootUrl: targetUrl,
      });
    }
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
    controlPresentation,
    pauseOrResume,
    retryFailures,
    restart,
  };
}
