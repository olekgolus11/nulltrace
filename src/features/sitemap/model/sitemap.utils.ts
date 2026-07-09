import { theme } from "../../../app/theme/theme";
import { SitemapNode } from "./sitemap.types";

interface FlatSitemapItem {
  path: string;
  status: number;
  method?: string;
}

function createNodeId(path: string, method?: string) {
  return `${path}::${method ?? "branch"}`;
}

export function buildTree(items: FlatSitemapItem[]): SitemapNode[] {
  // Root node acts as an invisible container
  const root: SitemapNode = {
    id: createNodeId(""),
    path: "",
    status: 0,
    children: [],
  };

  for (const item of items.filter((item) => item.path !== "/")) {
    const segments = item.path.split("/").filter((s) => s.length > 0);

    let current = root;
    let builtPath = "";

    for (let i = 0; i < segments.length; i++) {
      builtPath += "/" + segments[i];
      const isLeaf = i === segments.length - 1;

      const nodeMethod = isLeaf ? item.method : undefined;
      let child = current.children?.find(
        (candidate) =>
          candidate.path === builtPath && candidate.method === nodeMethod,
      );
      if (!child) {
        child = {
          id: createNodeId(builtPath, nodeMethod),
          path: builtPath,
          status: isLeaf ? item.status : 0,
          method: nodeMethod,
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
  const rootItems = items.filter((item) => item.path === "/");
  if (rootItems.length > 0) {
    return rootItems.map((item, index) => ({
      id: createNodeId(item.path, item.method),
      path: item.path,
      status: item.status,
      method: item.method,
      children: index === 0 ? root.children : [],
    }));
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
