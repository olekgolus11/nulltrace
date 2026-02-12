import { theme } from "../theme.ts";

interface PanelProps {
  title?: string;
  children: React.ReactNode;
  width?: number;
  height?: number;
  flexGrow?: number;
  flexDirection?: "row" | "column";
  border?: boolean;
  borderColor?: string;
  focused?: boolean;
  marginBottom?: number;
  padding?: number;
  paddingLeft?: number;
  paddingRight?: number;
  paddingTop?: number;
  paddingBottom?: number;
}

export function Panel({
  title,
  children,
  width,
  height,
  flexGrow,
  flexDirection = "column",
  border = true,
  borderColor = theme.border.default,
  focused = false,
  marginBottom,
  padding,
  paddingLeft = 1,
  paddingRight = 1,
  paddingTop = 1,
  paddingBottom = 1,
}: PanelProps) {
  const finalBorderColor = focused ? theme.accent.primary : borderColor;

  return (
    <box
      width={width}
      height={height}
      flexGrow={flexGrow}
      flexDirection={flexDirection}
      border={border}
      borderColor={finalBorderColor}
      marginBottom={marginBottom}
      padding={padding}
      paddingLeft={paddingLeft}
      paddingRight={paddingRight}
      paddingTop={paddingTop}
      paddingBottom={paddingBottom}
    >
      {title && (
        <box marginBottom={1}>
          <text fg={theme.accent.primary}>
            <strong>◆ {title}</strong>
          </text>
        </box>
      )}
      {children}
    </box>
  );
}
