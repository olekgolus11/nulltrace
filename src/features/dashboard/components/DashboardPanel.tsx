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
  paddingTop = 0,
  paddingBottom = 1,
  isHistoricPreview = false,
  onMouseDown,
}: PanelProps) {
  let finalBorderColor;
  let finalTitle;
  if (isHistoricPreview) {
    finalBorderColor = focused ? theme.accent.warning : borderColor;
    finalTitle = isHistoricPreview ? `${title} (Historic Preview)` : title;
  } else {
    finalBorderColor = focused ? theme.accent.primary : borderColor;
    finalTitle = title;
  }

  return (
    <box
      width={width}
      height={height}
      flexGrow={flexGrow}
      flexDirection={flexDirection}
      border={border}
      borderColor={finalBorderColor}
      title={finalTitle ? ` \u2726 ${finalTitle} ` : undefined}
      titleAlignment="left"
      marginBottom={marginBottom}
      padding={padding}
      paddingLeft={paddingLeft}
      paddingRight={paddingRight}
      paddingTop={paddingTop}
      paddingBottom={paddingBottom}
      onMouseDown={onMouseDown}
    >
      {children}
    </box>
  );
}
