import { theme, treeChars } from "../theme.ts";

// --- Data types ---

export interface SitemapNode {
  path: string;
  status: number;
  method?: string;
  children?: SitemapNode[];
}

export interface FlatSitemapItem {
  path: string;
  status: number;
  method?: string;
}

// --- Utility: build a tree from flat paths ---

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

// --- Utility: flatten tree into display-order list for keyboard navigation ---

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

// --- Status code color helper ---

function statusColor(status: number): string {
  if (status === 0) return theme.text.dim;
  if (status >= 500) return theme.severity.critical;
  if (status >= 400) return theme.severity.critical;
  if (status >= 300) return theme.accent.warning;
  if (status >= 200) return theme.severity.low;
  return theme.text.dim;
}

// --- Method color helper ---

function methodColor(method: string): string {
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

// --- Tree item component ---

interface SitemapTreeItemProps {
  node: SitemapNode;
  isLast: boolean;
  prefix: string; // accumulated prefix of "│  " and "   " from ancestors
  selectedPath: string | null; // path of the currently selected node
  focused: boolean;
}

function SitemapTreeItem({
  node,
  isLast,
  prefix,
  selectedPath,
  focused,
}: SitemapTreeItemProps) {
  const isSelected = focused && node.path === selectedPath;
  const branch = isLast ? treeChars.lastBranch : treeChars.branch;
  const hasChildren = node.children && node.children.length > 0;

  // Build the display label
  const showMethod =
    node.method && (!hasChildren || node.children!.length === 0);

  const statusStr = node.status > 0 ? ` [${node.status}]` : "";

  // The prefix for children: if this node is the last child, its children
  // get empty space; otherwise they get a vertical continuation line.
  const childPrefix = prefix + (isLast ? treeChars.empty : treeChars.vertical);

  return (
    <box flexDirection="column" flexGrow={1}>
      {/* This node's row */}
      <box
        flexDirection="row"
        backgroundColor={isSelected ? theme.bg.elevated : undefined}
        height={1}
      >
        <text fg={theme.text.dim}>{prefix}</text>
        <text fg={theme.text.dim}>{branch} </text>
        {showMethod ? (
          <>
            <text
              fg={isSelected ? theme.accent.primary : methodColor(node.method!)}
            >
              {isSelected ? <strong>{node.method}</strong> : node.method}
            </text>
            <text
              fg={isSelected ? theme.accent.primary : theme.accent.secondary}
            >
              {" "}
              {node.path}
            </text>
          </>
        ) : (
          <text fg={isSelected ? theme.accent.primary : theme.text.primary}>
            {isSelected ? <strong>{node.path}</strong> : node.path}
          </text>
        )}
        <text fg={statusColor(node.status)}>{statusStr}</text>
      </box>

      {/* Children */}
      {hasChildren && (
        <box flexDirection="column">
          {node.children!.map((child, idx) => (
            <SitemapTreeItem
              key={child.path}
              node={child}
              isLast={idx === node.children!.length - 1}
              prefix={childPrefix}
              selectedPath={selectedPath}
              focused={focused}
            />
          ))}
        </box>
      )}
    </box>
  );
}

// --- Main SitemapTree component ---

interface SitemapTreeProps {
  nodes: SitemapNode[];
  selectedIndex: number;
  focused: boolean;
}

export function SitemapTree({
  nodes,
  selectedIndex,
  focused,
}: SitemapTreeProps) {
  // Flatten to find which node is selected by index
  const flat = flattenTree(nodes);
  const selectedNode = flat[selectedIndex];
  const selectedPath = selectedNode ? selectedNode.path : null;

  return (
    <box flexDirection="column">
      {/* Title row */}
      <box>
        <text fg={theme.text.secondary}>
          <strong> Sitemap</strong>
        </text>
      </box>
      {/* Tree */}
      {nodes.map((node, idx) => (
        <SitemapTreeItem
          key={node.path}
          node={node}
          isLast={idx === nodes.length - 1}
          prefix=""
          selectedPath={selectedPath}
          focused={focused}
        />
      ))}
    </box>
  );
}
