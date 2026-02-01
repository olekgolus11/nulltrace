import { theme } from "../theme.ts";

interface SitemapItemData {
  path: string;
  status: number;
  type: string;
}

interface SitemapItemProps {
  item: SitemapItemData;
  isSelected: boolean;
}

export function SitemapItem({ item, isSelected }: SitemapItemProps) {
  const statusColor =
    item.status >= 400
      ? theme.severity.critical
      : item.status >= 300
        ? theme.accent.warning
        : theme.severity.low;

  return (
    <box
      flexDirection="row"
      backgroundColor={isSelected ? theme.bg.elevated : undefined}
      paddingLeft={1}
      paddingRight={1}
    >
      <box width={20}>
        <text fg={isSelected ? theme.accent.primary : theme.text.primary}>
          {isSelected ? (
            <strong>▸ {item.path}</strong>
          ) : (
            `  ${item.path}`
          )}
        </text>
      </box>
      <box width={8}>
        <text fg={statusColor}>{item.status}</text>
      </box>
      <box>
        <text fg={theme.text.dim}>{item.type}</text>
      </box>
    </box>
  );
}

interface SitemapListProps {
  items: SitemapItemData[];
  selectedIndex: number;
  focused: boolean;
}

export function SitemapList({ items, selectedIndex, focused }: SitemapListProps) {
  return (
    <box flexDirection="column" gap={0}>
      {items.map((item, idx) => (
        <SitemapItem
          key={item.path}
          item={item}
          isSelected={idx === selectedIndex && focused}
        />
      ))}
    </box>
  );
}
