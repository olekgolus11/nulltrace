import { Box, Text, useFocus, useInput } from "ink";

interface ButtonProps {
  label: string;
  onPress: () => void;
  focusId?: string;
  autoFocus?: boolean;
  width?: number;
}

export function Button({
  label,
  onPress,
  focusId,
  autoFocus = false,
  width,
}: ButtonProps) {
  const { isFocused } = useFocus({ id: focusId, autoFocus });

  useInput(
    (input, key) => {
      if (isFocused && (key.return || input === " ")) {
        onPress();
      }
    },
    { isActive: isFocused }
  );

  const buttonWidth = width || label.length + 4;

  return (
    <Box
      backgroundColor={isFocused ? "#D97706" : undefined}
      width={buttonWidth}
      justifyContent="center"
      paddingX={1}
    >
      <Text
        bold={isFocused}
        color={isFocused ? "#000000" : "#9CA3AF"}
      >
        {label}
      </Text>
    </Box>
  );
}
