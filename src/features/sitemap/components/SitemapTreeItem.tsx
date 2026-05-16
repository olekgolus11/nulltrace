import { treeChars, theme } from "../../../app/theme/theme";
import { SitemapNode } from "../model/sitemap.types";
import { methodColor, statusColor } from "../model/sitemap.utils";

interface SitemapTreeItemProps {
  node: SitemapNode;
  isLast: boolean;
  prefix: string;
  selectedPath: string | null;
  focused: boolean;
}

export function SitemapTreeItem({
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
    <box flexDirection="column">
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
