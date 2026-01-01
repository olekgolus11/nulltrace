import { Box, Text } from "ink";
import { theme, treeChars } from "../theme.ts";

interface SitemapNode {
  path: string;
  children?: SitemapNode[];
  method?: string;
  status?: number;
}

interface SitemapTreeProps {
  nodes: SitemapNode[];
  selectedPath?: string;
  onSelect?: (path: string) => void;
  maxHeight?: number;
}

function TreeNode({
  node,
  prefix = "",
  isLast = false,
  depth = 0,
  selectedPath,
}: {
  node: SitemapNode;
  prefix?: string;
  isLast?: boolean;
  depth?: number;
  selectedPath?: string;
}) {
  const isSelected = node.path === selectedPath;
  const branchChar = isLast ? treeChars.lastBranch : treeChars.branch;
  const childPrefix = prefix + (isLast ? treeChars.empty : treeChars.vertical);

  // Determine path display color based on characteristics
  const getPathColor = () => {
    if (isSelected) return theme.accent.primary;
    if (node.path.includes("admin")) return theme.accent.warning;
    if (node.path.includes("api")) return theme.accent.secondary;
    return theme.text.primary;
  };

  // Status indicator
  const getStatusIndicator = () => {
    if (!node.status) return null;
    const color =
      node.status >= 200 && node.status < 300
        ? theme.accent.low
        : node.status >= 400
          ? theme.accent.critical
          : theme.text.muted;
    return (
      <Text color={color} dimColor>
        {" "}
        [{node.status}]
      </Text>
    );
  };

  return (
    <>
      <Box>
        {depth > 0 && (
          <Text color={theme.text.dim}>
            {prefix}
            {branchChar}{" "}
          </Text>
        )}
        {node.method && (
          <Text color={theme.accent.secondary} bold>
            {node.method}{" "}
          </Text>
        )}
        <Text color={getPathColor()} bold={isSelected}>
          {node.path}
        </Text>
        {getStatusIndicator()}
      </Box>
      {node.children?.map((child, idx) => (
        <TreeNode
          key={child.path}
          node={child}
          prefix={depth > 0 ? childPrefix : ""}
          isLast={idx === (node.children?.length ?? 0) - 1}
          depth={depth + 1}
          selectedPath={selectedPath}
        />
      ))}
    </>
  );
}

export function SitemapTree({
  nodes,
  selectedPath,
  maxHeight,
}: SitemapTreeProps) {
  return (
    <Box
      flexDirection="column"
      height={maxHeight}
      overflow="hidden"
    >
      {nodes.map((node, idx) => (
        <TreeNode
          key={node.path}
          node={node}
          isLast={idx === nodes.length - 1}
          depth={0}
          selectedPath={selectedPath}
        />
      ))}
    </Box>
  );
}

// Mock data for demonstration
export const mockSitemap: SitemapNode[] = [
  {
    path: "/",
    status: 200,
    children: [
      {
        path: "/admin",
        status: 403,
        children: [
          { path: "/admin/login", status: 200 },
          { path: "/admin/dashboard", status: 401 },
          { path: "/admin/users", status: 401 },
        ],
      },
      {
        path: "/api",
        children: [
          { path: "/api/v1", children: [
            { path: "/api/v1/users", method: "GET", status: 200 },
            { path: "/api/v1/products", method: "GET", status: 200 },
            { path: "/api/v1/orders", method: "POST", status: 201 },
          ]},
          { path: "/api/health", status: 200 },
        ],
      },
      {
        path: "/shop",
        status: 200,
        children: [
          { path: "/shop/products", status: 200 },
          { path: "/shop/cart", status: 200 },
          { path: "/shop/checkout", status: 200 },
        ],
      },
      { path: "/about", status: 200 },
      { path: "/contact", status: 200 },
      { path: "/robots.txt", status: 200 },
      { path: "/.git", status: 403 },
    ],
  },
];

