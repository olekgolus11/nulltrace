export interface SitemapNode {
  path: string;
  status: number;
  method?: string;
  children?: SitemapNode[];
}
