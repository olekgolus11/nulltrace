import { Tool } from "../model/dashboard.types";
import { ToolCard } from "./ToolCard";

interface ToolListProps {
  tools: Tool[];
  selectedIndex: number;
  focused: boolean;
  onSelectTool?: (index: number) => void;
}

export function ToolList({ tools, selectedIndex, focused, onSelectTool }: ToolListProps) {
  return (
    <box flexDirection="column">
      {tools.map((tool, idx) => (
        <ToolCard
          key={tool.id}
          tool={tool}
          isSelected={idx === selectedIndex && focused}
          onMouseDown={onSelectTool ? () => onSelectTool(idx) : undefined}
        />
      ))}
    </box>
  );
}
