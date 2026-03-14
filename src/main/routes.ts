export type Screen =
  | { type: "entry" }
  | { type: "dashboard"; targetUrl: string }
  | { type: "tool"; toolId: string; toolName: string; targetUrl: string };
