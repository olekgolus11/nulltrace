import { InputRenderable } from "@opentui/core";
import { useRef } from "react";
import { theme } from "../../../app/theme/theme";
import { ChatMessageData } from "../model/chat.types";
import { ChatMessage } from "./ChatMessage";
import "opentui-spinner/react";

interface ChatWindowProps {
  messages: ChatMessageData[];
  inputValue: string;
  onInputChange: (value: string) => void;
  onSubmit: (value: string) => void;
  placeholder?: string;
  focused?: boolean;
  isGenerating?: boolean;
  isDisabled?: boolean;
}

function SpinnerAiMessage() {
  return (
    <ChatMessage sender="ai" content="">
      <spinner name="dots" color="white" />
    </ChatMessage>
  );
}

export function ChatWindow({
  messages,
  inputValue,
  onInputChange,
  onSubmit,
  placeholder = "Ask about findings, request scans...",
  focused = false,
  isGenerating = false,
  isDisabled = false,
}: ChatWindowProps) {
  const inputRef = useRef<InputRenderable | null>(null);

  const submitInput = (value: unknown) => {
    const inputSubmitValue = typeof value === "string" ? value : "";
    const submittedValue = inputSubmitValue.trim()
      ? inputSubmitValue
      : inputValue;
    const prompt = submittedValue.trim();

    if (!prompt || isDisabled) {
      return;
    }

    if (inputRef.current) {
      inputRef.current.value = "";
    }
    onInputChange("");
    onSubmit(prompt);
  };

  const shouldShowSpinner =
    isGenerating && messages[messages.length - 1]?.sender === "user";

  return (
    <box flexDirection="column" flexGrow={1}>
      <scrollbox
        flexGrow={1}
        minHeight={0}
        width="100%"
        scrollX={false}
        stickyScroll={true}
        stickyStart="bottom"
        contentOptions={{
          flexDirection: "column",
          paddingBottom: 1,
        }}
        verticalScrollbarOptions={{
          width: 1,
          trackOptions: {
            backgroundColor: theme.border.muted,
            foregroundColor: theme.text.secondary,
          },
        }}
      >
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
        {shouldShowSpinner && <SpinnerAiMessage />}
      </scrollbox>

      <box flexDirection="row" gap={1} alignItems="center" width="100%">
        <box width={2} flexShrink={0}>
          <text fg={theme.accent.primary}>{">"}</text>
        </box>
        <box flexGrow={1} minWidth={0}>
          <input
            ref={inputRef}
            value={inputValue}
            onChange={onInputChange}
            onSubmit={submitInput}
            width="100%"
            placeholder={placeholder}
            focused={focused && !isDisabled}
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
