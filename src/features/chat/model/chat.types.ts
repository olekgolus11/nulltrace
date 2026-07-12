import { ChatToolActivity } from "./chat-tool-activity.types";

export interface ChatMessageData {
  id: string;
  sender: "ai" | "user" | "system";
  content: string;
  timestamp: string;
  activities?: ChatToolActivity[];
}
