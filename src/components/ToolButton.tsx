import { Box, Text, useFocus, useInput } from "ink";
import { theme } from "../theme.ts";

interface ToolButtonProps {
  label: string;
  icon?: string;
  onPress: () => void;
  focusId?: string;
  autoFocus?: boolean;
  width?: number;
  description?: string;
}

export function ToolButton({
  label,
  icon,
  onPress,
  focusId,
  autoFocus = false,
  width = 12,
  description,
}: ToolButtonProps) {
  const { isFocused } = useFocus({ id: focusId, autoFocus });

  useInput(
    (input, key) => {
      if (isFocused && (key.return || input === " ")) {
        onPress();
      }
    },
    { isActive: isFocused }
  );

  return (
    <Box
      flexDirection="column"
      width={width}
      borderStyle="round"
      borderColor={isFocused ? theme.accent.primary : theme.border.muted}
      backgroundColor={isFocused ? theme.bg.elevated : theme.bg.panel}
      paddingX={1}
      alignItems="center"
    >
      {icon && (
        <Text color={isFocused ? theme.accent.primary : theme.text.secondary}>
          {icon}
        </Text>
      )}
      <Text
        bold={isFocused}
        color={isFocused ? theme.accent.primary : theme.text.primary}
      >
        {label}
      </Text>
      {description && (
        <Text color={theme.text.dim} dimColor>
          {description}
        </Text>
      )}
    </Box>
  );
}

// Grid of tool buttons
interface ToolGridProps {
  tools: Array<{
    id: string;
    label: string;
    icon?: string;
    description?: string;
  }>;
  onSelect: (toolId: string) => void;
  columns?: number;
}

export function ToolGrid({ tools, onSelect, columns = 2 }: ToolGridProps) {
  // Group tools into rows
  const rows: Array<typeof tools> = [];
  for (let i = 0; i < tools.length; i += columns) {
    rows.push(tools.slice(i, i + columns));
  }

  return (
    <Box flexDirection="column" gap={1}>
      {rows.map((row, rowIdx) => (
        <Box key={rowIdx} flexDirection="row" gap={1}>
          {row.map((tool) => (
            <ToolButton
              key={tool.id}
              label={tool.label}
              icon={tool.icon}
              description={tool.description}
              onPress={() => onSelect(tool.id)}
              focusId={`tool-${tool.id}`}
            />
          ))}
        </Box>
      ))}
    </Box>
  );
}

