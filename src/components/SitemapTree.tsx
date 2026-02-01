import { theme, treeChars } from "../theme.ts";

interface SitemapNode {
  path: string;
  status: number;
  type?: string;
  children?: SitemapNode[];
}

interface SitemapTreeItemProps {
  node: SitemapNode;
  depth: number;
  isLast: boolean;
  isSelected: boolean;
}

function SitemapTreeItem({
  node,
  depth,
  isLast,
  isSelected,
}: SitemapTreeItemProps) {
  const indent = " ".repeat(depth * 2);
  const branch = isLast ? treeChars.lastBranch : treeChars.branch;

  const statusColor =
    node.status >= 400
      ? theme.severity.critical
      : node.status >= 300
        ? theme.accent.warning
        : theme.severity.low;

  return (
    <box flexDirection="column">
      <box
        flexDirection="row"
        backgroundColor={isSelected ? theme.bg.elevated : undefined}
      >
        <text fg={theme.text.dim}>{indent}</text>
        <text fg={theme.text.dim}>{branch}</text>
        <text fg={isSelected ? theme.accent.primary : theme.text.primary}>
          {isSelected ? <strong>▸ {node.path}</strong> : ` ${node.path}`}
        </text>
        <text fg={statusColor}> [{node.status}]</text>
        {node.type && <text fg={theme.text.dim}> {node.type}</text>}
      </box>

      {/* Render children */}
      {node.children && (
        <box flexDirection="column">
          {node.children.map((child, idx) => (
            <SitemapTreeItem
              key={child.path}
              node={child}
              depth={depth + 1}
              isLast={idx === (node.children?.length || 0) - 1}
              isSelected={false}
            />
          ))}
        </box>
      )}
    </box>
  );
}

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
  return (
    <box flexDirection="column">
      {nodes.map((node, idx) => (
        <SitemapTreeItem
          key={node.path}
          node={node}
          depth={0}
          isLast={idx === nodes.length - 1}
          isSelected={focused && idx === selectedIndex}
        />
      ))}
    </box>
  );
}

// Flattened version for simple list display
interface SitemapItemFlat {
  path: string;
  status: number;
  method?: string;
}

interface SitemapListProps {
  items: SitemapItemFlat[];
  selectedIndex: number;
  focused: boolean;
}

export function SitemapList({
  items,
  selectedIndex,
  focused,
}: SitemapListProps) {
  return (
    <box flexDirection="column">
      {items.map((item, idx) => {
        const isSelected = focused && idx === selectedIndex;
        const statusColor =
          item.status >= 400
            ? theme.severity.critical
            : item.status >= 300
              ? theme.accent.warning
              : theme.severity.low;

        return (
          <box
            key={item.path}
            flexDirection="row"
            backgroundColor={isSelected ? theme.bg.elevated : undefined}
            paddingLeft={1}
          >
            <text fg={theme.text.dim}>{isSelected ? "▸" : " "}</text>
            <text width={8} fg={theme.text.dim}>
              {item.method || "GET"}
            </text>
            <text
              width={25}
              fg={isSelected ? theme.accent.primary : theme.text.primary}
            >
              {item.path}
            </text>
            <text fg={statusColor}>[{item.status}]</text>
          </box>
        );
      })}
    </box>
  );
}
