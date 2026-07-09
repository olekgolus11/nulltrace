import { publicSitemapCrawler } from "./public-sitemap-crawler.service";
import { SitemapCrawlCoordinator } from "./sitemap-crawl-coordinator.service";
import { sitemapRepository } from "./sitemap.repository";

export const sitemapCrawlCoordinator = new SitemapCrawlCoordinator(
  sitemapRepository,
  publicSitemapCrawler,
);
