import { useState, useEffect, type ReactNode } from "react";
import { Box, useStdout } from "ink";
import { Sidebar } from "./Sidebar.tsx";

interface ScreenProps {
  children: ReactNode;
}

export function Screen({ children }: ScreenProps) {
  const { stdout } = useStdout();
  const [dimensions, setDimensions] = useState({
    width: stdout.columns || 80,
    height: stdout.rows || 24,
  });

  useEffect(() => {
    const handleResize = () => {
      setDimensions({
        width: stdout.columns || 80,
        height: stdout.rows || 24,
      });
    };

    stdout.on("resize", handleResize);
    return () => {
      stdout.off("resize", handleResize);
    };
  }, [stdout]);

  const sidebarWidth = 32;
  const mainWidth = dimensions.width - sidebarWidth;

  return (
    <Box
      width={dimensions.width}
      height={dimensions.height}
      flexDirection="row"
      backgroundColor="#0D1117"
    >
      {/* Main content area */}
      <Box
        width={mainWidth}
        height={dimensions.height}
        flexDirection="column"
        justifyContent="center"
        alignItems="center"
      >
        {children}
      </Box>

      {/* Sidebar */}
      <Sidebar />
    </Box>
  );
}
