import { theme } from "../../../app/theme/theme";
import { PanelProps } from "../model/dashboard.types";

export function DashboardPanel({
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
