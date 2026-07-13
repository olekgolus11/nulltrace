import { describe, expect, it } from "bun:test";
import { TargetSitemapEntryRecord } from "./sitemap.types";
import { filterTargetSitemapEntries } from "./sitemap-read-model";

function entry(
  id: string,
  depth: number,
  provenance: TargetSitemapEntryRecord["provenance"],
): TargetSitemapEntryRecord {
  return {
    id,
    targetId: "target-1",
    normalizedUrl: `https://example.com/${id}`,
    path: `/${id}`,
    method: "GET",
    httpStatus: 200,
    source: "html_link",
    provenance,
    depth,
    firstSeenAt: "2026-07-13T10:00:00.000Z",
    lastSeenAt: "2026-07-13T10:00:00.000Z",
    createdAt: "2026-07-13T10:00:00.000Z",
  };
}

describe("filterTargetSitemapEntries", () => {
  it("combines depth and exact discovery provenance filters", () => {
    const entries = [
      entry("public", 1, "public"),
      entry("authenticated", 2, "authenticated"),
      entry("both", 2, "both"),
      entry("deep", 3, "authenticated"),
    ];

    expect(filterTargetSitemapEntries(entries, 2, "authenticated").map((item) => item.id))
      .toEqual(["authenticated"]);
    expect(filterTargetSitemapEntries(entries, null, "both").map((item) => item.id))
      .toEqual(["both"]);
    expect(filterTargetSitemapEntries(entries, 1, "all").map((item) => item.id))
      .toEqual(["public"]);
  });
});
