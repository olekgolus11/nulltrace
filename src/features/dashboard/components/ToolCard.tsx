import { theme } from "../../../app/theme/theme";
import { ToolCardProps } from "../model/dashboard.types";

export function ToolCard({ tool, isSelected }: ToolCardProps) {
  return (
    <box
      flexDirection="column"
      backgroundColor={isSelected ? theme.bg.elevated : undefined}
      paddingLeft={1}
      paddingRight={1}
      paddingTop={1}
      paddingBottom={1}
      border={isSelected}
      borderColor={isSelected ? theme.accent.primary : theme.border.default}
    >
      <box flexDirection="row" gap={1} alignItems="center">
        <text>{tool.icon}</text>
        <text fg={isSelected ? theme.accent.primary : theme.text.primary}>
          {isSelected ? <strong>{tool.name}</strong> : tool.name}
        </text>
      </box>
      <box paddingLeft={3}>
        <text fg={theme.text.dim}>{tool.description}</text>
      </box>
    </box>
  );
}
