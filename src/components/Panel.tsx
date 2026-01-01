import { Box, Text, type BoxProps } from "ink";
import { theme, boxChars } from "../theme.ts";
import type { ReactNode } from "react";

interface PanelProps {
  title?: string;
  children: ReactNode;
  width?: number | string;
  height?: number | string;
  borderColor?: string;
  focused?: boolean;
  padding?: number;
}

export function Panel({
  title,
  children,
  width,
  height,
  borderColor,
  focused = false,
  padding = 1,
}: PanelProps) {
  const activeBorderColor = focused
    ? theme.border.focus
    : borderColor || theme.border.muted;

  return (
    <Box
      flexDirection="column"
      width={width}
      height={height}
      borderStyle="round"
      borderColor={activeBorderColor}
      backgroundColor={theme.bg.panel}
    >
      {title && (
        <Box marginTop={-1} marginLeft={1}>
          <Text color={focused ? theme.accent.primary : theme.text.secondary}>
            {" "}
            {title}{" "}
          </Text>
        </Box>
      )}
      <Box
        flexDirection="column"
        paddingX={padding}
        paddingY={padding > 0 ? 0 : 0}
        flexGrow={1}
      >
        {children}
      </Box>
    </Box>
  );
}

// Simpler panel without border for inline sections
interface SectionProps {
  title: string;
  children: ReactNode;
  titleColor?: string;
}

export function Section({ title, children, titleColor }: SectionProps) {
  return (
    <Box flexDirection="column" marginBottom={1}>
      <Text bold color={titleColor || theme.accent.primary}>
        {title}
      </Text>
      <Box flexDirection="column" paddingLeft={1}>
        {children}
      </Box>
    </Box>
  );
}

