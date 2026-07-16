import { treeChars, theme } from "../../../app/theme/theme";
import { SitemapNode } from "../model/sitemap.types";
import { methodColor, statusColor } from "../model/sitemap.utils";

interface SitemapTreeItemProps {
  node: SitemapNode;
  isLast: boolean;
  prefix: string;
  selectedId: string | null;
  focused: boolean;
}

export function SitemapTreeItem({
  node,
  isLast,
  prefix,
  selectedId,
  focused,
}: SitemapTreeItemProps) {
  const isSelected = focused && node.id === selectedId;
  const branch = isLast ? treeChars.lastBranch : treeChars.branch;
  const hasChildren = node.children && node.children.length > 0;

  // Build the display label
  const showMethod = Boolean(node.method);

  const statusStr = node.status > 0 ? ` [${node.status}]` : "";
  const provenanceLabel = node.provenance
    ? ` [${node.provenance === "authenticated" ? "AUTH" : node.provenance.toUpperCase()}]`
    : "";
  const sessionAccessLabel = node.accessObservation ? " [SESSION ACCESS]" : "";

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
            <text fg={isSelected ? theme.accent.primary : methodColor(node.method!)}>
              {isSelected ? <strong>{node.method}</strong> : node.method}
            </text>
            <text fg={isSelected ? theme.accent.primary : theme.accent.secondary}>
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
        <text fg={theme.accent.info}>{provenanceLabel}</text>
        <text fg={theme.accent.secondary}>{sessionAccessLabel}</text>
      </box>

      {/* Children */}
      {hasChildren && (
        <box flexDirection="column">
          {node.children!.map((child, idx) => (
            <SitemapTreeItem
              key={child.id}
              node={child}
              isLast={idx === node.children!.length - 1}
              prefix={childPrefix}
              selectedId={selectedId}
              focused={focused}
            />
          ))}
        </box>
      )}
    </box>
  );
}
