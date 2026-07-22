import { AuthenticatedRequestContextMetadata } from "../../authentication/model/authenticated-request-context.types";
import { CommandSource } from "../../tool/shared/types/tool-screen.types";
import { ActionDraftRecord } from "../model/action-draft.types";

export interface ActionDraftWorkspaceApplication {
  toolData: unknown;
  commandInput: string;
  generatedCommand: string;
  commandSource: CommandSource;
  message: string;
}

export type ActionDraftWorkspaceApplyResult =
  | {
      ok: true;
      application: ActionDraftWorkspaceApplication;
    }
  | {
      ok: false;
      reason: string;
    };

export interface ActionDraftWorkspaceMapInput {
  draft: ActionDraftRecord;
  currentToolName: string;
  currentToolData: unknown;
  buildGeneratedCommand: (toolData: unknown) => string;
  authenticatedContext?: AuthenticatedRequestContextMetadata | null;
}
