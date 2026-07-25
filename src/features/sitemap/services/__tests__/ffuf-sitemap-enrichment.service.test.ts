import { describe, expect, test } from "bun:test";
import { FfufSitemapEnrichmentService } from "../ffuf-sitemap-enrichment.service";

function createArtifact(results: unknown[]) {
  return {
    id: "artifact-1",
    toolRunId: "run-1",
    artifactType: "ffuf_content_discovery",
    label: "FFUF Content Discovery",
    source: "ffuf.json",
    payload: { results },
    createdAt: "2026-07-24T10:00:00.000Z",
  };
}

describe("FfufSitemapEnrichmentService", () => {
  test("upserts exact-origin FFUF matches with public provenance", () => {
    const inputs: unknown[] = [];
    const upsertEntry = (input: unknown) => {
      inputs.push(input);
      return null as never;
    };
    const service = new FfufSitemapEnrichmentService(
      {
        getSessionById: () => ({
          id: "session-1",
          targetId: "target-1",
          normalizedUrl: "https://example.com",
          displayUrl: "https://example.com",
          createdAt: "2026-07-24T10:00:00.000Z",
          lastActivityAt: "2026-07-24T10:00:00.000Z",
        }),
      },
      { upsertEntry },
    );

    const result = service.upsertContentDiscoveryResults("session-1", [
      createArtifact([
        { url: "https://example.com/hidden", status: 200, input: { FUZZ: "hidden" } },
        { url: "https://outside.example/hidden", status: 200, input: { FUZZ: "hidden" } },
      ]),
    ]);

    expect(result).toBe(1);
    expect(inputs).toEqual([
      {
        targetId: "target-1",
        normalizedUrl: "https://example.com/hidden",
        path: "/hidden",
        method: "GET",
        httpStatus: 200,
        source: "ffuf",
        provenance: "public",
        depth: 1,
      },
    ]);
  });

  test("leaves malformed artifacts and unknown sessions outside sitemap", () => {
    const upsertEntry = () => {
      throw new Error("should not write");
    };
    const service = new FfufSitemapEnrichmentService(
      { getSessionById: () => null },
      { upsertEntry },
    );

    expect(service.upsertContentDiscoveryResults("missing", [createArtifact(["bad"])] )).toBe(0);
  });
});
