import { describe, expect, it } from "bun:test";
import { TargetSitemapEntryRecord } from "../sitemap.types";
import {
  filterTargetSitemapEntries,
  getTargetSitemapEntryDisplayStatus,
} from "../sitemap-read-model";

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

    expect(filterTargetSitemapEntries(entries, 2, "authenticated").map((item) => item.id)).toEqual([
      "authenticated",
    ]);
    expect(filterTargetSitemapEntries(entries, null, "both").map((item) => item.id)).toEqual([
      "both",
    ]);
    expect(filterTargetSitemapEntries(entries, 1, "all").map((item) => item.id)).toEqual([
      "public",
    ]);
  });
});

describe("getTargetSitemapEntryDisplayStatus", () => {
  it("uses the current session observation when no public status exists", () => {
    const authenticatedEntry = {
      ...entry("authenticated", 1, "authenticated"),
      httpStatus: null,
    };
    const observation = {
      sessionId: "session-1",
      targetId: "target-1",
      entryId: authenticatedEntry.id,
      httpStatus: 403,
      observedAt: "2026-07-14T10:00:00.000Z",
    };

    expect(getTargetSitemapEntryDisplayStatus(authenticatedEntry, observation)).toBe(403);
    expect(
      getTargetSitemapEntryDisplayStatus({ ...authenticatedEntry, httpStatus: 200 }, observation),
    ).toBe(200);
    expect(getTargetSitemapEntryDisplayStatus(authenticatedEntry)).toBe(0);
  });
});
