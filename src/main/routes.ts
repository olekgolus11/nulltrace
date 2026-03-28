import { ToolName } from "../features/tool/shared/types/tool-screen.types";

export type Screen =
  | { type: "entry" }
  | { type: "dashboard"; sessionId: string; targetUrl: string }
  | { type: "tool"; toolName: ToolName; sessionId: string; targetUrl: string };
