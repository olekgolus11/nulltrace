import { theme } from "../theme.ts";

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

interface ChatMessageData {
  id: string;
  sender: "ai" | "user" | "system";
  content: string;
  timestamp: string;
}

interface ChatWindowProps {
  messages: ChatMessageData[];
  inputValue: string;
  onInputChange: (value: string) => void;
  onSubmit: () => void;
  placeholder?: string;
  focused?: boolean;
}

export function ChatWindow({
  messages,
  inputValue,
  onInputChange,
  onSubmit,
  placeholder = "Ask about vulnerabilities, request scans...",
  focused = false,
}: ChatWindowProps) {
  return (
    <box flexDirection="column" flexGrow={1}>
      {/* Messages area */}
      <box flexDirection="column" flexGrow={1} paddingBottom={1}>
        {messages.length === 0 ? (
          <box
            flexDirection="column"
            alignItems="center"
            justifyContent="center"
            flexGrow={1}
          >
            <text fg={theme.text.dim}>
              No messages yet. Start a conversation!
            </text>
          </box>
        ) : (
          messages.map((msg) => (
            <ChatMessage
              key={msg.id}
              sender={msg.sender}
              content={msg.content}
              timestamp={msg.timestamp}
            />
          ))
        )}
      </box>

      {/* Input area */}
      <box flexDirection="row" gap={1} alignItems="center">
        <text fg={theme.accent.primary}>{">"}</text>
        <input
          value={inputValue}
          onChange={onInputChange}
          placeholder={placeholder}
          width="100%"
          focused={focused}
          backgroundColor={theme.bg.input}
          textColor={theme.text.primary}
          cursorColor={theme.accent.primary}
          focusedBackgroundColor={theme.bg.elevated}
          placeholderColor={theme.text.dim}
        />
      </box>
    </box>
  );
}
