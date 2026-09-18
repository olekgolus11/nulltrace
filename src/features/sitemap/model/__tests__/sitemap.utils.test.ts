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

  it("keeps root methods and descendants unique in the flattened tree", () => {
    const nodes = buildTree([
      { entryId: "root-get", path: "/", status: 200, method: "GET" },
      { entryId: "root-post", path: "/", status: 405, method: "POST" },
      { entryId: "login", path: "/login", status: 200, method: "GET" },
    ]);

    const entries = flattenTree(nodes).filter((node) => node.entryId);

    expect(entries.map((entry) => entry.entryId)).toEqual(["root-get", "root-post", "login"]);
    expect(new Set(entries.map((entry) => entry.id)).size).toBe(3);
  });
});
