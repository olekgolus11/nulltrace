import { theme } from "../../../app/theme/theme";
import { ChatToolActivity } from "../model/chat-tool-activity.types";
interface ChatMessageProps {
  sender: "ai" | "user" | "system";
  content: string;
  timestamp?: string;
  activities?: ChatToolActivity[];
  children?: React.ReactNode;
}

export function ChatMessage({
  sender,
  content,
  timestamp,
  activities = [],
  children,
}: ChatMessageProps) {
  const isAI = sender === "ai";
  const isUser = sender === "user";
  const isSystem = sender === "system";

  return (
    <box flexDirection="column" flexShrink={0} marginBottom={1}>
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
        {content && <text fg={theme.text.primary}>{content}</text>}
        {activities.map((activity) => (
          <box key={activity.id} flexDirection="row" gap={1}>
            <text fg={theme.text.secondary}>◦ {activity.label}</text>
            <text
              fg={
                activity.status === "failed"
                  ? theme.severity.high
                  : activity.status === "completed"
                    ? theme.accent.low
                    : theme.accent.warning
              }
            >
              {activity.status === "running"
                ? "Running"
                : activity.status === "completed"
                  ? "Completed"
                  : "Failed"}
            </text>
          </box>
        ))}
        {children}
      </box>
    </box>
  );
}
