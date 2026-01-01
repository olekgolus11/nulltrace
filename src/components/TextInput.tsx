import { useState, useEffect } from "react";
import { Box, Text, useInput } from "ink";
import { theme } from "../theme.ts";

interface TextInputProps {
  value: string;
  onChange: (value: string) => void;
  onSubmit?: (value: string) => void;
  placeholder?: string;
  width?: number;
  focused?: boolean;
  prefix?: string;
}

export function TextInput({
  value,
  onChange,
  onSubmit,
  placeholder = "",
  width = 40,
  focused = true,
  prefix,
}: TextInputProps) {
  const [cursorVisible, setCursorVisible] = useState(true);

  // Blinking cursor effect
  useEffect(() => {
    if (!focused) return;

    const interval = setInterval(() => {
      setCursorVisible((v) => !v);
    }, 500);

    return () => clearInterval(interval);
  }, [focused]);

  useInput(
    (input, key) => {
      if (!focused) return;

      if (key.return && onSubmit) {
        onSubmit(value);
        return;
      }

      if (key.backspace || key.delete) {
        onChange(value.slice(0, -1));
        return;
      }

      // Only add printable characters
      if (input && !key.ctrl && !key.meta) {
        onChange(value + input);
      }
    },
    { isActive: focused }
  );

  const displayValue = value || "";
  const showPlaceholder = !value && placeholder;
  const cursor = focused && cursorVisible ? "▌" : " ";

  const contentWidth = width - 2; // Account for padding
  const displayText = showPlaceholder
    ? placeholder
    : displayValue.slice(-contentWidth);

  return (
    <Box
      borderStyle="round"
      borderColor={focused ? theme.accent.primary : theme.border.muted}
      backgroundColor={theme.bg.input}
      width={width}
      paddingX={1}
    >
      {prefix && (
        <Text color={theme.accent.primary} bold>
          {prefix}{" "}
        </Text>
      )}
      <Text color={showPlaceholder ? theme.text.dim : theme.text.primary}>
        {displayText}
      </Text>
      <Text color={theme.accent.primary}>{cursor}</Text>
    </Box>
  );
}

// Simpler inline input without border
interface InlineInputProps {
  value: string;
  onChange: (value: string) => void;
  onSubmit?: (value: string) => void;
  placeholder?: string;
  focused?: boolean;
}

export function InlineInput({
  value,
  onChange,
  onSubmit,
  placeholder = "Type a message...",
  focused = true,
}: InlineInputProps) {
  const [cursorVisible, setCursorVisible] = useState(true);

  useEffect(() => {
    if (!focused) return;

    const interval = setInterval(() => {
      setCursorVisible((v) => !v);
    }, 500);

    return () => clearInterval(interval);
  }, [focused]);

  useInput(
    (input, key) => {
      if (!focused) return;

      if (key.return && onSubmit) {
        onSubmit(value);
        return;
      }

      if (key.backspace || key.delete) {
        onChange(value.slice(0, -1));
        return;
      }

      if (input && !key.ctrl && !key.meta) {
        onChange(value + input);
      }
    },
    { isActive: focused }
  );

  const displayValue = value || "";
  const showPlaceholder = !value && placeholder;
  const cursor = focused && cursorVisible ? "▌" : "";

  return (
    <Box>
      <Text color={theme.accent.primary} bold>
        {">"}{" "}
      </Text>
      <Text color={showPlaceholder ? theme.text.dim : theme.text.primary}>
        {showPlaceholder ? placeholder : displayValue}
      </Text>
      <Text color={theme.accent.primary}>{cursor}</Text>
    </Box>
  );
}

