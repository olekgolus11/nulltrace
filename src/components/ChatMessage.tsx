import { Box, Text } from "ink";
import { theme } from "../theme.ts";

type MessageType = "ai" | "user" | "system";

interface ChatMessageProps {
  type: MessageType;
  content: string;
  timestamp?: string;
}

export function ChatMessage({ type, content, timestamp }: ChatMessageProps) {
  const isAI = type === "ai";
  const isUser = type === "user";
  const isSystem = type === "system";

  const accentColor = isAI
    ? theme.chat.ai
    : isUser
      ? theme.chat.user
      : theme.chat.system;

  const label = isAI ? "AI" : isUser ? "You" : "System";
  const icon = isAI ? "◆" : isUser ? "●" : "○";

  if (isSystem) {
    return (
      <Box marginY={0} paddingX={1}>
        <Text color={theme.text.dim} italic>
          {content}
        </Text>
      </Box>
    );
  }

  return (
    <Box flexDirection="column" marginY={0}>
      {/* Message header */}
      <Box>
        <Text color={accentColor} bold>
          {icon} {label}
        </Text>
        {timestamp && (
          <Text color={theme.text.dim}> · {timestamp}</Text>
        )}
      </Box>

      {/* Message content */}
      <Box paddingLeft={2} marginBottom={1}>
        <Text color={theme.text.primary} wrap="wrap">
          {content}
        </Text>
      </Box>
    </Box>
  );
}

// Chat container with scrollable messages
interface ChatWindowProps {
  messages: Array<{
    type: MessageType;
    content: string;
    timestamp?: string;
  }>;
  maxHeight?: number;
}

export function ChatWindow({ messages, maxHeight }: ChatWindowProps) {
  return (
    <Box
      flexDirection="column"
      height={maxHeight}
      overflow="hidden"
    >
      {messages.map((msg, idx) => (
        <ChatMessage
          key={idx}
          type={msg.type}
          content={msg.content}
          timestamp={msg.timestamp}
        />
      ))}
    </Box>
  );
}

