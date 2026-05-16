import { theme } from "../../../app/theme/theme";
import { ChatMessageData } from "../model/chat.types";
import { ChatMessage } from "./ChatMessage";

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

      <box flexDirection="row" gap={1} alignItems="center" width="100%">
        <box width={2} flexShrink={0}>
          <text fg={theme.accent.primary}>{">"}</text>
        </box>
        <box flexGrow={1} minWidth={0}>
          <input
            value={inputValue}
            onChange={onInputChange}
            width="100%"
            placeholder={placeholder}
            focused={focused}
            backgroundColor={theme.bg.input}
            textColor={theme.text.primary}
            cursorColor={theme.accent.primary}
            focusedBackgroundColor={theme.bg.elevated}
            placeholderColor={theme.text.dim}
          />
        </box>
      </box>
    </box>
  );
}
