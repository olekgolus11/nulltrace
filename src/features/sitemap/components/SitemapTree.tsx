import { theme } from "../../../app/theme/theme";
import { SitemapNode } from "../model/sitemap.types";
import { flattenTree } from "../model/sitemap.utils";
import { SitemapTreeItem } from "./SitemapTreeItem";

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
  const flat = flattenTree(nodes);
  const selectedNode = flat[selectedIndex];
  const selectedId = selectedNode ? selectedNode.id : null;

  return (
    <box flexDirection="column">
      {nodes.map((node, idx) => (
        <SitemapTreeItem
          key={node.id}
          node={node}
          isLast={idx === nodes.length - 1}
          prefix=""
          selectedId={selectedId}
          focused={focused}
        />
      ))}
    </box>
  );
}
