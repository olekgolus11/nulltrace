import { theme } from "../../../app/theme/theme";
import { Tool } from "../model/dashboard.types";

interface ToolCardProps {
  tool: Tool;
  isSelected: boolean;
  onMouseDown?: () => void;
}

export function ToolCard({ tool, isSelected, onMouseDown }: ToolCardProps) {
  return (
    <box
      flexDirection="row"
      justifyContent="space-between"
      alignItems="center"
      width="100%"
      backgroundColor={isSelected ? theme.bg.elevated : undefined}
      paddingLeft={1}
      paddingRight={1}
      border={isSelected}
      borderColor={isSelected ? theme.accent.primary : theme.border.default}
      onMouseDown={onMouseDown ? (event) => {
        if (event.button !== 0) {
          return;
        }
        event.stopPropagation();
        onMouseDown();
      } : undefined}
    >
      <box flexDirection="row" gap={1} alignItems="center">
        <text>{tool.icon}</text>
        <text fg={isSelected ? theme.accent.primary : theme.text.primary}>
          {isSelected ? <strong>{tool.name}</strong> : tool.name}
        </text>
      </box>
      <box>
        <text fg={theme.text.dim}>{tool.description}</text>
      </box>
    </box>
  );
}
