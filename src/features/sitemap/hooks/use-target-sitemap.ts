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
  const [state, setState] = useState<TargetSitemapState>({
    entries: [],
    status: null,
  });

  useEffect(() => {
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

  const nodes = useMemo(
    () =>
      buildTree(
        state.entries.map((entry) => ({
          path: entry.path,
          status: entry.httpStatus ?? 0,
          method: entry.method ?? undefined,
        })),
      ),
    [state.entries],
  );
  const flatNodes = useMemo(() => flattenTree(nodes), [nodes]);

  return {
    entries: state.entries,
    nodes,
    flatNodes,
    status: state.status,
  };
}
