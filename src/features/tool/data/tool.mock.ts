import { ChatMessageData } from "../../chat/model/chat.types";

export const mockToolChatMessages: ChatMessageData[] = [
  {
    id: "tool-system-1",
    sender: "system",
    content: "Tool workspace ready. Configure a scan profile or edit the full command directly.",
    timestamp: "14:40",
  },
  {
    id: "tool-ai-1",
    sender: "ai",
    content: "Start with a conservative scan, then escalate with scripts or aggressive mode if you need more coverage.",
    timestamp: "14:40",
  },
];

export const mockToolOutputLines = [
  "Awaiting command.",
  "Use the form to build a scan or edit the full command manually.",
];
