export type ChatToolActivityStatus = "running" | "completed" | "failed";

export interface ChatToolActivity {
  id: string;
  label: string;
  status: ChatToolActivityStatus;
}
