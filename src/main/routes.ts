import { ToolName } from "../features/tool/shared/types/tool-screen.types";

export type Screen =
  | { type: "entry" }
  | { type: "dashboard"; targetUrl: string }
  | { type: "tool"; toolName: ToolName; targetUrl: string };
