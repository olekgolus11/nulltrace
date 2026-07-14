import { describe, expect, it } from "bun:test";
import { buildTree, flattenTree } from "../sitemap.utils";

describe("buildTree", () => {
  it("preserves entries that share a path but use different methods", () => {
    const nodes = buildTree([
      { path: "/login", status: 200, method: "GET" },
      { path: "/login", status: 405, method: "POST" },
    ]);

    const entries = flattenTree(nodes);

    expect(entries).toHaveLength(2);
    expect(entries.map((entry) => entry.method)).toEqual(["GET", "POST"]);
    expect(new Set(entries.map((entry) => entry.id)).size).toBe(2);
  });
});
