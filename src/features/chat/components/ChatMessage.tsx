import { theme } from "../../../app/theme/theme";
interface ChatMessageProps {
  sender: "ai" | "user" | "system";
  content: string;
  timestamp?: string;
}

export function ChatMessage({ sender, content, timestamp }: ChatMessageProps) {
  const isAI = sender === "ai";
  const isUser = sender === "user";
  const isSystem = sender === "system";

  return (
    <box flexDirection="column" marginBottom={1}>
      <box flexDirection="row" gap={1}>
        <text
          fg={
            isAI ? theme.chat.ai : isUser ? theme.chat.user : theme.chat.system
          }
        >
          <strong>{isAI ? "◆ AI" : isUser ? "● You" : "○ System"}</strong>
        </text>
        {timestamp && <text fg={theme.text.dim}>{timestamp}</text>}
      </box>
      <box paddingLeft={2}>
        <text fg={theme.text.primary}>{content}</text>
      </box>
    </box>
  );
}
