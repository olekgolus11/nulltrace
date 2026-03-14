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

export interface SitemapTreeProps {
  nodes: SitemapNode[];
  selectedIndex: number;
  focused: boolean;
}

export interface SitemapTreeItemProps {
  node: SitemapNode;
  isLast: boolean;
  prefix: string; // accumulated prefix of "│  " and "   " from ancestors
  selectedPath: string | null; // path of the currently selected node
  focused: boolean;
}
