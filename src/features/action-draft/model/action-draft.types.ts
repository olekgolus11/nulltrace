import { ScannerToolId } from "../../tool/shared/registry/scanner-catalog";

export type ActionDraftStatus =
  | "draft"
  | "applied"
  | "dismissed"
  | "superseded";

export interface ActionDraftInput {
  sessionId: string;
  opencodeConversationId?: string | null;
  targetTool: ScannerToolId;
  title: string;
  summary: string;
  payload: unknown;
}

export interface ActionDraftRecord extends ActionDraftInput {
  id: string;
  opencodeConversationId: string | null;
  status: ActionDraftStatus;
  createdAt: string;
  updatedAt: string;
}

export interface SetActionDraftStatusInput {
  actionDraftId: string;
  status: ActionDraftStatus;
}
