import { theme } from "../theme.ts";

interface Tool {
  id: string;
  name: string;
  description: string;
  icon: string;
}

interface ToolCardProps {
  tool: Tool;
  isSelected: boolean;
}

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
      borderColor={isSelected ? theme.accent.primary : undefined}
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

interface ToolListProps {
  tools: Tool[];
  selectedIndex: number;
  focused: boolean;
}

export function ToolList({ tools, selectedIndex, focused }: ToolListProps) {
  return (
    <box flexDirection="column" gap={1}>
      {tools.map((tool, idx) => (
        <ToolCard
          key={tool.id}
          tool={tool}
          isSelected={idx === selectedIndex && focused}
        />
      ))}
    </box>
  );
}
