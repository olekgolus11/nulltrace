import { ToolName } from "../features/tool/shared/types/tool-screen.types";

export type Screen =
  | { type: "entry" }
  | { type: "dashboard" }
  | { type: "tool"; toolName: ToolName; pendingActionDraftId?: string | null };
