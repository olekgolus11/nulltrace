export interface ChatMessageData {
  id: string;
  sender: "ai" | "user" | "system";
  content: string;
  timestamp: string;
}
