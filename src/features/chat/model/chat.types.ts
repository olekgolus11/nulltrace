export interface ChatMessageProps {
  sender: "ai" | "user" | "system";
  content: string;
  timestamp?: string;
}

export interface ChatMessageData {
  id: string;
  sender: "ai" | "user" | "system";
  content: string;
  timestamp: string;
}

export interface ChatWindowProps {
  messages: ChatMessageData[];
  inputValue: string;
  onInputChange: (value: string) => void;
  onSubmit: () => void;
  placeholder?: string;
  focused?: boolean;
}
