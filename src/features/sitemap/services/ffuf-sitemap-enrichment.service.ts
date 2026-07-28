import { ToolRunArtifactRecord } from "../../session/model/session.repository.types";
import { sessionRepository } from "../../session/services/session.repository";
import { selectExactOriginFfufMatches } from "../../tool/ffuf/services/ffuf-output.helpers";
import {
  readFfufArtifactProvenance,
  readFfufArtifactResults,
} from "./ffuf-sitemap-enrichment.helpers";
import { sitemapRepository } from "./sitemap.repository";

interface SessionContextRepository {
  getSessionById: typeof sessionRepository.getSessionById;
}

interface SitemapEntryRepository {
  upsertEntry: typeof sitemapRepository.upsertEntry;
}

export class FfufSitemapEnrichmentService {
  constructor(
    private readonly sessions: SessionContextRepository = sessionRepository,
    private readonly sitemap: SitemapEntryRepository = sitemapRepository,
  ) {}

  upsertContentDiscoveryResults(sessionId: string, artifacts: ToolRunArtifactRecord[]) {
    const session = this.sessions.getSessionById(sessionId);
    if (!session) return 0;

    return artifacts.reduce((count, artifact) => {
      if (artifact.artifactType !== "ffuf_content_discovery") return count;

      const matches = selectExactOriginFfufMatches(
        readFfufArtifactResults(artifact.payload),
        session.normalizedUrl,
      );
      const provenance = readFfufArtifactProvenance(artifact.payload);
      matches.forEach((match) => {
        this.sitemap.upsertEntry({
          targetId: session.targetId,
          normalizedUrl: match.normalizedUrl,
          path: match.path,
          method: "GET",
          httpStatus: match.httpStatus,
          source: "ffuf",
          provenance,
          depth: match.depth,
        });
      });
      return count + matches.length;
    }, 0);
  }
}

export const ffufSitemapEnrichmentService = new FfufSitemapEnrichmentService();
