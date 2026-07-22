import { useEffect, useState } from "react";
import { theme } from "../../../app/theme/theme";
import { ActiveSessionConversation } from "../services/session-conversation.service";

interface ConversationSwitcherProps {
  conversations: ActiveSessionConversation[];
  activeConversationId: string | null;
  availableWidth: number;
  isDisabled: boolean;
  onSelectConversation: (conversationId: string) => void;
  onCreateConversation: () => void;
  onArchiveConversation: () => void;
}

const defaultTabWidth = 20;
const compactTabWidth = 16;
const defaultNewConversationWidth = 9;
const compactNewConversationWidth = 3;
const defaultArchiveConversationWidth = 9;
const compactArchiveConversationWidth = 3;
const navigationTileWidth = 3;
const compactWidthBreakpoint = 42;
const minimumTabWidth = 8;
const rowGap = 1;

function clamp(value: number, min: number, max: number) {
  return Math.max(min, Math.min(max, value));
}

function truncateTitle(title: string, maxLength: number) {
  if (title.length <= maxLength) {
    return title;
  }

  return `${title.slice(0, Math.max(1, maxLength - 1))}…`;
}

export function ConversationSwitcher({
  conversations,
  activeConversationId,
  availableWidth,
  isDisabled,
  onSelectConversation,
  onCreateConversation,
  onArchiveConversation,
}: ConversationSwitcherProps) {
  const [windowStartIndex, setWindowStartIndex] = useState(0);
  const isCompact = availableWidth < compactWidthBreakpoint;
  const preferredTabWidth = isCompact ? compactTabWidth : defaultTabWidth;
  const newConversationWidth = isCompact
    ? compactNewConversationWidth
    : defaultNewConversationWidth;
  const archiveConversationWidth = isCompact
    ? compactArchiveConversationWidth
    : defaultArchiveConversationWidth;
  const fixedTileCount = 4;
  const activeIndex = conversations.findIndex(
    (conversation) => conversation.attachment.opencodeConversationId === activeConversationId,
  );
  const reservedWidth =
    navigationTileWidth * 2 +
    newConversationWidth +
    archiveConversationWidth +
    rowGap * fixedTileCount;
  const tabWidth = Math.max(
    minimumTabWidth,
    Math.min(preferredTabWidth, availableWidth - reservedWidth),
  );
  const visibleCount = Math.max(
    1,
    Math.floor((availableWidth - reservedWidth) / (tabWidth + rowGap)),
  );
  const maxStartIndex = Math.max(0, conversations.length - visibleCount);

  useEffect(() => {
    setWindowStartIndex((currentStartIndex) => {
      if (activeIndex < 0) {
        return clamp(currentStartIndex, 0, maxStartIndex);
      }
      if (activeIndex < currentStartIndex) {
        return activeIndex;
      }
      if (activeIndex >= currentStartIndex + visibleCount) {
        return activeIndex - visibleCount + 1;
      }

      return clamp(currentStartIndex, 0, maxStartIndex);
    });
  }, [activeIndex, maxStartIndex, visibleCount]);

  const visibleConversations = conversations.slice(
    windowStartIndex,
    windowStartIndex + visibleCount,
  );
  const hasPrevious = windowStartIndex > 0;
  const hasNext = windowStartIndex + visibleCount < conversations.length;
  const onPreviousPage = () => {
    if (isDisabled || !hasPrevious) {
      return;
    }

    setWindowStartIndex((currentStartIndex) => Math.max(0, currentStartIndex - visibleCount));
  };
  const onNextPage = () => {
    if (isDisabled || !hasNext) {
      return;
    }

    setWindowStartIndex((currentStartIndex) =>
      Math.min(maxStartIndex, currentStartIndex + visibleCount),
    );
  };

  return (
    <box flexDirection="row" gap={1} height={1} width="100%" marginBottom={1}>
      <box
        width={navigationTileWidth}
        height={1}
        alignItems="center"
        justifyContent="center"
        backgroundColor={theme.border.default}
        onMouseDown={onPreviousPage}
      >
        <text fg={hasPrevious && !isDisabled ? theme.text.primary : theme.text.dim}>‹</text>
      </box>
      {visibleConversations.map((conversation) => {
        const conversationId = conversation.attachment.opencodeConversationId;
        const isActive = conversationId === activeConversationId;
        const label = truncateTitle(conversation.title, tabWidth - 4);

        return (
          <box
            key={conversationId}
            width={tabWidth}
            height={1}
            alignItems="center"
            justifyContent="center"
            backgroundColor={isActive ? theme.accent.primary : theme.border.default}
            onMouseDown={() => {
              if (!isDisabled) {
                onSelectConversation(conversationId);
              }
            }}
          >
            <text
              fg={isDisabled ? theme.text.dim : isActive ? theme.text.inverse : theme.text.primary}
            >
              {isActive ? <strong>{label}</strong> : label}
            </text>
          </box>
        );
      })}
      <box
        width={navigationTileWidth}
        height={1}
        alignItems="center"
        justifyContent="center"
        backgroundColor={theme.border.default}
        onMouseDown={onNextPage}
      >
        <text fg={hasNext && !isDisabled ? theme.text.primary : theme.text.dim}>›</text>
      </box>
      <box
        width={newConversationWidth}
        height={1}
        alignItems="center"
        justifyContent="center"
        backgroundColor={theme.border.default}
        onMouseDown={() => {
          if (!isDisabled) {
            onCreateConversation();
          }
        }}
      >
        <text fg={isDisabled ? theme.text.dim : theme.accent.secondary}>
          {isCompact ? "+" : "+ New"}
        </text>
      </box>
      <box
        width={archiveConversationWidth}
        height={1}
        alignItems="center"
        justifyContent="center"
        backgroundColor={theme.border.default}
        onMouseDown={() => {
          if (!isDisabled && activeConversationId) {
            onArchiveConversation();
          }
        }}
      >
        <text fg={isDisabled || !activeConversationId ? theme.text.dim : theme.accent.warning}>
          {isCompact ? "×" : "Archive"}
        </text>
      </box>
    </box>
  );
}
