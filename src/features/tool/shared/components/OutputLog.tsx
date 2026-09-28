import { theme } from "../../../../app/theme/theme";
import { standardScrollbarTrackOptions } from "../../../../shared/ui/scrollbar.config";

const outputContentOptions = {
  flexDirection: "column",
  alignItems: "flex-start",
} as const;

export function OutputLog({
  lines,
  focused,
  height,
}: {
  lines: string[];
  focused: boolean;
  height: number;
}) {
  return (
    <scrollbox
      height={height}
      focused={focused}
      scrollX={true}
      stickyScroll={false}
      contentOptions={outputContentOptions}
      horizontalScrollbarOptions={{
        trackOptions: standardScrollbarTrackOptions,
      }}
      verticalScrollbarOptions={{
        trackOptions: standardScrollbarTrackOptions,
      }}
    >
      {lines.length === 0 ? (
        <text fg={theme.text.dim}>No output yet.</text>
      ) : (
        lines.map((line, index) => (
          <text
            key={`line-${index}-${line}`}
            flexShrink={0}
            width={Math.max(1, Bun.stringWidth(line))}
            wrapMode="none"
            fg={
              line.startsWith("[execution failed]") ? theme.accent.critical : theme.text.primary
            }
          >
            {line || " "}
          </text>
        ))
      )}
    </scrollbox>
  );
}
