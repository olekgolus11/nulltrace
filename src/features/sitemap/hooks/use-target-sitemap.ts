import { useEffect, useMemo, useState } from "react";
import { buildTree, flattenTree } from "../model/sitemap.utils";
import {
  TargetSitemapCrawlStatusRecord,
  TargetSitemapEntryRecord,
} from "../model/sitemap.types";
import { sitemapRepository } from "../services/sitemap.repository";

interface TargetSitemapState {
  entries: TargetSitemapEntryRecord[];
  status: TargetSitemapCrawlStatusRecord | null;
}

function readTargetSitemap(targetId: string): TargetSitemapState {
  const result = sitemapRepository.listEntries({
    targetId,
    limit: 500,
  });

  return {
    entries: result.entries,
    status: sitemapRepository.getCrawlStatus(targetId),
  };
}

export function useTargetSitemap(targetId: string | null) {
  const [maxDepth, setMaxDepth] = useState<number | null>(null);
  const [state, setState] = useState<TargetSitemapState>({
    entries: [],
    status: null,
  });

  useEffect(() => {
    setMaxDepth(null);

    if (!targetId) {
      setState({
        entries: [],
        status: null,
      });
      return;
    }

    const refresh = () => {
      setState(readTargetSitemap(targetId));
    };

    refresh();
    const interval = setInterval(refresh, 1000);

    return () => clearInterval(interval);
  }, [targetId]);

  const availableMaxDepth = useMemo(
    () => Math.max(0, ...state.entries.map((entry) => entry.depth)),
    [state.entries],
  );
  const visibleEntries = useMemo(
    () =>
      maxDepth === null
        ? state.entries
        : state.entries.filter((entry) => entry.depth <= maxDepth),
    [maxDepth, state.entries],
  );

  const nodes = useMemo(
    () =>
      buildTree(
        visibleEntries.map((entry) => ({
          path: entry.path,
          status: entry.httpStatus ?? 0,
          method: entry.method ?? undefined,
        })),
      ),
    [visibleEntries],
  );
  const flatNodes = useMemo(() => flattenTree(nodes), [nodes]);

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

  return {
    entries: state.entries,
    visibleEntries,
    nodes,
    flatNodes,
    status: state.status,
    maxDepth,
    cycleMaxDepth,
  };
}
