import { theme } from "../../../app/theme/theme";

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
    <scrollbox height={height} focused={focused} scrollX={true} stickyScroll={false}>
      <box flexDirection="column">
        {lines.length === 0 ? (
          <text fg={theme.text.dim}>No output yet.</text>
        ) : (
          lines.map((line, index) => (
            <text
              key={`line-${index}-${line}`}
              fg={line.startsWith("[execution failed]") ? theme.accent.critical : theme.text.primary}
            >
              {line || " "}
            </text>
          ))
        )}
      </box>
    </scrollbox>
  );
}
