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
  const selectedPath = selectedNode ? selectedNode.path : null;

  return (
    <box flexDirection="column">
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
