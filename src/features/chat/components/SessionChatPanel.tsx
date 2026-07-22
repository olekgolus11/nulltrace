import { theme } from "../../../app/theme/theme";
import { ChatMessageData } from "../model/chat.types";
import { ActiveSessionConversation } from "../services/session-conversation.service";
import { ChatWindow } from "./ChatWindow";
import { ConversationSwitcher } from "./ConversationSwitcher";

interface SessionChatPanelProps {
  messages: ChatMessageData[];
  inputValue: string;
  availableWidth: number;
  activeConversationId: string | null;
  conversations: ActiveSessionConversation[];
  conversationError: string | null;
  chatError: string | null;
  isLoadingConversations: boolean;
  isCreatingConversation: boolean;
  isArchivingConversation: boolean;
  isLoadingMessages: boolean;
  isGenerating: boolean;
  focused: boolean;
  placeholder?: string;
  onInputChange: (value: string) => void;
  onSubmit: (value: string) => void;
  onSelectConversation: (conversationId: string) => void;
  onCreateConversation: () => void;
  onArchiveConversation: () => void;
}

export function SessionChatPanel({
  messages,
  inputValue,
  availableWidth,
  activeConversationId,
  conversations,
  conversationError,
  chatError,
  isLoadingConversations,
  isCreatingConversation,
  isArchivingConversation,
  isLoadingMessages,
  isGenerating,
  focused,
  placeholder,
  onInputChange,
  onSubmit,
  onSelectConversation,
  onCreateConversation,
  onArchiveConversation,
}: SessionChatPanelProps) {
  const runtimeStatusMessage = conversationError
    ? `OpenCode runtime error: ${conversationError}`
    : activeConversationId
      ? null
      : "Preparing OpenCode conversation...";
  const chatStatusMessage = chatError ? `Chat error: ${chatError}` : null;
  const isConversationBusy =
    isLoadingConversations || isCreatingConversation || isArchivingConversation || isGenerating;

  return (
    <>
      <ConversationSwitcher
        conversations={conversations}
        activeConversationId={activeConversationId}
        availableWidth={availableWidth}
        isDisabled={isConversationBusy}
        onSelectConversation={onSelectConversation}
        onCreateConversation={onCreateConversation}
        onArchiveConversation={onArchiveConversation}
      />
      <box marginBottom={1}>
        {runtimeStatusMessage && (
          <text fg={conversationError ? theme.severity.high : theme.text.secondary}>
            {runtimeStatusMessage}
          </text>
        )}
      </box>
      {chatStatusMessage ? (
        <box marginBottom={1}>
          <text fg={chatError ? theme.severity.high : theme.text.secondary}>
            {chatStatusMessage}
          </text>
        </box>
      ) : null}
      {isLoadingMessages ? (
        <box flexGrow={1} alignItems="center" justifyContent="center">
          <text fg={theme.text.dim}>Loading conversation…</text>
        </box>
      ) : (
        <ChatWindow
          messages={messages}
          inputValue={inputValue}
          onInputChange={onInputChange}
          onSubmit={onSubmit}
          placeholder={placeholder}
          focused={focused}
          isGenerating={isGenerating}
          isDisabled={
            isLoadingConversations ||
            isCreatingConversation ||
            isArchivingConversation ||
            isGenerating ||
            !activeConversationId
          }
        />
      )}
    </>
  );
}
