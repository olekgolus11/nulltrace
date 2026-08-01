import { SessionReportDraft } from "./session-report.types";

export const sessionReportDraftExecutiveSummaryStyles = [
  "risk_prioritized",
  "review_status",
  "remediation",
] as const;

export const sessionReportDraftDescriptionStyles = [
  "concise",
  "technical",
  "review_focused",
] as const;

export const sessionReportDraftRecommendationActions = [
  "verify",
  "contain",
  "remediate",
  "retest",
] as const;

export type SessionReportDraftExecutiveSummaryStyle =
  (typeof sessionReportDraftExecutiveSummaryStyles)[number];

export type SessionReportDraftDescriptionStyle =
  (typeof sessionReportDraftDescriptionStyles)[number];

export type SessionReportDraftRecommendationAction =
  (typeof sessionReportDraftRecommendationActions)[number];

export interface SessionReportDraftFindingPlan {
  findingId: string;
  descriptionStyle: SessionReportDraftDescriptionStyle;
  recommendationActions: SessionReportDraftRecommendationAction[];
}

export interface SessionReportDraftEditorialPlan {
  executiveSummaryStyle: SessionReportDraftExecutiveSummaryStyle;
  findings: SessionReportDraftFindingPlan[];
}

export interface SessionReportDraftRecord {
  id: string;
  sessionId: string;
  selectedFindingIds: string[];
  markdown: string;
  createdAt: string;
  updatedAt: string;
}

export interface SaveSessionReportDraftInput {
  sessionId: string;
  selectedFindingIds: string[];
  markdown: string;
}

export interface SessionReportDraftReadModel {
  createDraft(sessionId: string): SessionReportDraft | null;
}

export interface SessionReportDraftProviderInput {
  sessionId: string;
  prompt: string;
  signal?: AbortSignal;
}

export interface SessionReportDraftProvider {
  generate(input: SessionReportDraftProviderInput): Promise<string>;
}

export interface SessionReportDraftStore {
  save(input: SaveSessionReportDraftInput): SessionReportDraftRecord;
  findBySessionId(sessionId: string): SessionReportDraftRecord | null;
}

export interface GenerateSessionReportDraftInput {
  sessionId: string;
  selectedFindingIds: string[];
  signal?: AbortSignal;
}

export type GenerateSessionReportDraftResult =
  | {
      status: "success";
      markdown: string;
      selectedFindingIds: string[];
    }
  | {
      status: "error";
      message: string;
    };
