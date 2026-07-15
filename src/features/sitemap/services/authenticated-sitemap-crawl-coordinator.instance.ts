import { authenticatedRequestContextService } from "../../authentication/services/authenticated-request-context.service";
import { authCheckService } from "../../authentication/services/auth-check.service";
import { authenticatedSitemapCrawler } from "./authenticated-sitemap-crawler.service";
import { AuthenticatedSitemapCrawlCoordinator } from "./authenticated-sitemap-crawl-coordinator.service";
import { sitemapRepository } from "./sitemap.repository";

export const authenticatedSitemapCrawlCoordinator =
  new AuthenticatedSitemapCrawlCoordinator(
    authenticatedRequestContextService,
    authenticatedSitemapCrawler,
    sitemapRepository,
    authCheckService,
  );
