import { ToolListProps } from "../model/dashboard.types";
import { ToolCard } from "./ToolCard";

export function ToolList({ tools, selectedIndex, focused }: ToolListProps) {
  return (
    <box flexDirection="column">
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
