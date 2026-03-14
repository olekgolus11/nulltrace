import { theme } from "../../../app/theme/theme";
import { FlatSitemapItem, SitemapNode } from "./sitemap.types";

export function buildTree(items: FlatSitemapItem[]): SitemapNode[] {
  // Root node acts as an invisible container
  const root: SitemapNode = { path: "", status: 0, children: [] };

  for (const item of items) {
    const segments = item.path.split("/").filter((s) => s.length > 0);

    let current = root;
    let builtPath = "";

    for (let i = 0; i < segments.length; i++) {
      builtPath += "/" + segments[i];
      const isLeaf = i === segments.length - 1;

      let child = current.children?.find((c) => c.path === builtPath);
      if (!child) {
        child = {
          path: builtPath,
          status: isLeaf ? item.status : 0,
          method: isLeaf ? item.method : undefined,
          children: [],
        };
        if (!current.children) current.children = [];
        current.children.push(child);
      }

      // If this intermediate node is also an explicit entry, update its status
      if (isLeaf) {
        child.status = item.status;
        child.method = item.method;
      }

      current = child;
    }
  }

  // Handle root "/" entry: check if any item is exactly "/"
  const rootItem = items.find((i) => i.path === "/");
  if (rootItem) {
    // Insert "/" as the first top-level node
    const rootEntry: SitemapNode = {
      path: "/",
      status: rootItem.status,
      method: rootItem.method,
      children: [],
    };
    // Move existing top-level children under "/" ? No - the screenshot shows
    // "/" as a sibling of /admin, /api, etc. But looking more carefully at the
    // screenshot, "/" is the very first entry and /admin, /api etc are its
    // children (they are indented under it with tree lines).
    // Let's make "/" the single root that contains everything.
    rootEntry.children = root.children || [];
    return [rootEntry];
  }

  return root.children || [];
}

export function flattenTree(nodes: SitemapNode[]): SitemapNode[] {
  const result: SitemapNode[] = [];
  function walk(nodeList: SitemapNode[]) {
    for (const node of nodeList) {
      result.push(node);
      if (node.children && node.children.length > 0) {
        walk(node.children);
      }
    }
  }
  walk(nodes);
  return result;
}

export function statusColor(status: number): string {
  if (status === 0) return theme.text.dim;
  if (status >= 500) return theme.severity.critical;
  if (status >= 400) return theme.severity.critical;
  if (status >= 300) return theme.accent.warning;
  if (status >= 200) return theme.severity.low;
  return theme.text.dim;
}

export function methodColor(method: string): string {
  switch (method.toUpperCase()) {
    case "GET":
      return theme.severity.low;
    case "POST":
      return theme.accent.warning;
    case "PUT":
      return theme.accent.info;
    case "DELETE":
      return theme.severity.critical;
    default:
      return theme.text.secondary;
  }
}
