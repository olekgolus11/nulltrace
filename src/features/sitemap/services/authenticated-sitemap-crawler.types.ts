import { AuthenticatedRequestContext } from "../../authentication/model/authenticated-request-context.types";
import {
  AuthenticatedSitemapAccessObservationInput,
  AuthenticatedSitemapCrawlStatus,
  SitemapCrawlCheckpoint,
  SitemapCrawlRunMode,
  UpsertTargetSitemapEntryInput,
} from "../model/sitemap.types";
import { SitemapCrawlerLimits } from "./sitemap-crawler.types";

export interface AuthenticatedSitemapCrawlerPersistence {
  upsertEntry(input: UpsertTargetSitemapEntryInput): { id: string };
  upsertAccessObservation(input: AuthenticatedSitemapAccessObservationInput): unknown;
  markAuthenticatedCrawlRunning(sessionId: string, targetId: string): unknown;
  markAuthenticatedCrawlCompleted(sessionId: string, targetId: string): unknown;
  markAuthenticatedCrawlAuthenticationRequired(
    sessionId: string,
    targetId: string,
    errorMessage: string,
  ): unknown;
  markAuthenticatedCrawlFailed(sessionId: string, targetId: string, errorMessage: string): unknown;
  markAuthenticatedCrawlPaused?(sessionId: string, targetId: string): unknown;
  saveCrawlCheckpoint?(input: Omit<SitemapCrawlCheckpoint, "updatedAt">): unknown;
  getCrawlCheckpoint?(crawlerType: "authenticated", ownerId: string): SitemapCrawlCheckpoint | null;
  deleteCrawlCheckpoint?(crawlerType: "authenticated", ownerId: string): unknown;
}

export interface AuthenticatedSitemapCrawlerInput {
  sessionId: string;
  targetId: string;
  rootUrl: string;
  context: AuthenticatedRequestContext;
  limits?: Partial<SitemapCrawlerLimits>;
  mode?: SitemapCrawlRunMode;
}

export interface AuthenticatedSitemapCrawlerResult {
  status: Extract<
    AuthenticatedSitemapCrawlStatus,
    "completed" | "paused" | "authentication_required" | "failed"
  >;
  pagesFetched: number;
  entriesDiscovered: number;
  errorMessage?: string;
}
