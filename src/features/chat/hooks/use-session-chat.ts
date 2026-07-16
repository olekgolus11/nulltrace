import { useCallback, useEffect, useState } from "react";
import { ChatMessageData } from "../model/chat.types";
import { ChatRuntime } from "../model/chat-runtime.types";
import { openCodeChatRuntimeService } from "../services/opencode-chat-runtime.service";

interface UseSessionChatResult {
  inputValue: string;
  messages: ChatMessageData[];
  isLoading: boolean;
  isGenerating: boolean;
  error: string | null;
  setInputValue: (value: string) => void;
  submitPrompt: (prompt: string) => Promise<void>;
  submitInput: (value: string) => void;
}

interface UseSessionChatOptions {
  onPromptComplete?: () => void;
}

function getReadableError(error: unknown) {
  return error instanceof Error ? error.message : String(error);
}

function createLocalUserMessage(prompt: string): ChatMessageData {
  return {
    id: `local-user-${Date.now()}`,
    sender: "user",
    content: prompt,
    timestamp: new Date().toLocaleTimeString([], {
      hour: "2-digit",
      minute: "2-digit",
    }),
  };
}

function upsertMessage(messages: ChatMessageData[], nextMessage: ChatMessageData) {
  const existingIndex = messages.findIndex((message) => message.id === nextMessage.id);
  if (existingIndex === -1) {
    return [...messages, nextMessage];
  }

  return messages.map((message, index) => (index === existingIndex ? nextMessage : message));
}

export function useSessionChat(
  sessionId: string | null,
  conversationId: string | null,
  options: UseSessionChatOptions = {},
  runtime: ChatRuntime = openCodeChatRuntimeService,
): UseSessionChatResult {
  const [inputValue, setInputValue] = useState("");
  const [messages, setMessages] = useState<ChatMessageData[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [isGenerating, setIsGenerating] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let isCurrentRequest = true;

    async function loadMessages() {
      if (!sessionId || !conversationId) {
        setMessages([]);
        setError(null);
        return;
      }

      setIsLoading(true);
      setMessages([]);
      setInputValue("");
      setError(null);

      try {
        const loadedMessages = await runtime.listMessages(sessionId, conversationId);
        if (isCurrentRequest) {
          setMessages(loadedMessages);
        }
      } catch (loadError) {
        if (isCurrentRequest) {
          setError(getReadableError(loadError));
        }
      } finally {
        if (isCurrentRequest) {
          setIsLoading(false);
        }
      }
    }

    void loadMessages();

    return () => {
      isCurrentRequest = false;
    };
  }, [conversationId, runtime, sessionId]);

  const submitPrompt = useCallback(
    async (prompt: string) => {
      if (!sessionId || !conversationId) {
        setError("No active OpenCode conversation is ready yet.");
        return;
      }

      setIsGenerating(true);
      setError(null);
      setMessages((currentMessages) => [...currentMessages, createLocalUserMessage(prompt)]);

      try {
        const assistantMessages = await runtime.sendPrompt(
          sessionId,
          conversationId,
          prompt,
          (message) => {
            setMessages((currentMessages) => upsertMessage(currentMessages, message));
          },
        );
        const loadedMessages = await runtime.listMessages(sessionId, conversationId);

        if (loadedMessages.length > 0) {
          setMessages(loadedMessages);
        } else {
          setMessages((currentMessages) => [...currentMessages, ...assistantMessages]);
        }
        options.onPromptComplete?.();
      } catch (submitError) {
        setError(getReadableError(submitError));
      } finally {
        setIsGenerating(false);
      }
    },
    [conversationId, options, runtime, sessionId],
  );

  const submitInput = useCallback(
    (value: string) => {
      const prompt = value.trim();
      if (!prompt) {
        return;
      }

      setInputValue("");
      void submitPrompt(prompt);
    },
    [submitPrompt],
  );

  return {
    inputValue,
    messages,
    isLoading,
    isGenerating,
    error,
    setInputValue,
    submitPrompt,
    submitInput,
  };
}
