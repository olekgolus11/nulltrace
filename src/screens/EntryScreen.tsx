import { useState, useEffect } from "react";
import { Box, Text, useInput, useStdout } from "ink";
import { theme } from "../theme.ts";
import { Panel } from "../components/Panel.tsx";
import { TextInput } from "../components/TextInput.tsx";

interface EntryScreenProps {
  onStartPentest: (url: string) => void;
}

// Mock previous sessions
const mockSessions = [
  { url: "example.com", date: "2025-12-28", vulns: 7 },
  { url: "testsite.io", date: "2025-12-25", vulns: 3 },
  { url: "vulnerable-app.local", date: "2025-12-20", vulns: 12 },
  { url: "api.mycompany.dev", date: "2025-12-15", vulns: 0 },
];

// ASCII art title
const titleArt = [
  "╔═══════════════════════════════════════════════════════════════╗",
  "║  ██████╗ ███████╗███╗   ██╗████████╗███████╗███████╗████████╗ ║",
  "║  ██╔══██╗██╔════╝████╗  ██║╚══██╔══╝██╔════╝██╔════╝╚══██╔══╝ ║",
  "║  ██████╔╝█████╗  ██╔██╗ ██║   ██║   █████╗  ███████╗   ██║    ║",
  "║  ██╔═══╝ ██╔══╝  ██║╚██╗██║   ██║   ██╔══╝  ╚════██║   ██║    ║",
  "║  ██║     ███████╗██║ ╚████║   ██║   ███████╗███████║   ██║    ║",
  "║  ╚═╝     ╚══════╝╚═╝  ╚═══╝   ╚═╝   ╚══════╝╚══════╝   ╚═╝    ║",
  "║                         ◆ AI POWERED ◆                        ║",
  "╚═══════════════════════════════════════════════════════════════╝",
];

export function EntryScreen({ onStartPentest }: EntryScreenProps) {
  const { stdout } = useStdout();
  const [dimensions, setDimensions] = useState({
    width: stdout.columns || 80,
    height: stdout.rows || 24,
  });
  const [url, setUrl] = useState("");
  const [selectedSession, setSelectedSession] = useState(-1);
  const [focusArea, setFocusArea] = useState<"input" | "sessions">("input");

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

  useInput((input, key) => {
    // Tab to switch focus areas
    if (key.tab) {
      setFocusArea((prev) => (prev === "input" ? "sessions" : "input"));
      if (focusArea === "input") {
        setSelectedSession(0);
      } else {
        setSelectedSession(-1);
      }
      return;
    }

    // Handle session navigation
    if (focusArea === "sessions") {
      if (key.upArrow) {
        setSelectedSession((prev) => Math.max(0, prev - 1));
      }
      if (key.downArrow) {
        setSelectedSession((prev) =>
          Math.min(mockSessions.length - 1, prev + 1)
        );
      }
      if (key.return && selectedSession >= 0) {
        onStartPentest(mockSessions[selectedSession].url);
      }
    }

    // Submit URL
    if (focusArea === "input" && key.return && url.trim()) {
      onStartPentest(url.trim());
    }
  });

  const sidebarWidth = 30;
  const mainWidth = dimensions.width - sidebarWidth - 2;

  return (
    <Box
      flexDirection="row"
      width={dimensions.width}
      height={dimensions.height}
      backgroundColor={theme.bg.primary}
    >
      {/* Main content area */}
      <Box
        width={mainWidth}
        height={dimensions.height}
        flexDirection="column"
        justifyContent="center"
        alignItems="center"
        paddingX={2}
      >
        {/* ASCII Title */}
        <Box flexDirection="column" alignItems="center" marginBottom={2}>
          {titleArt.map((line, idx) => (
            <Text key={`title-${idx}`} color={theme.accent.primary}>
              {line}
            </Text>
          ))}
        </Box>

        {/* Subtitle */}
        <Box marginBottom={2}>
          <Text color={theme.text.secondary}>
            AI-powered penetration testing assistant for web applications
          </Text>
        </Box>

        {/* URL Input */}
        <Box flexDirection="column" alignItems="center" marginBottom={2}>
          <Box marginBottom={1}>
            <Text color={theme.text.muted}>Enter target URL to begin:</Text>
          </Box>
          <TextInput
            value={url}
            onChange={setUrl}
            onSubmit={(val) => val.trim() && onStartPentest(val.trim())}
            placeholder="https://target-website.com"
            width={50}
            focused={focusArea === "input"}
            prefix="◆"
          />
        </Box>

        {/* Start button hint */}
        <Box marginTop={1}>
          <Text color={theme.text.dim}>
            Press <Text color={theme.accent.primary}>Enter</Text> to start
            pentest or <Text color={theme.accent.primary}>Tab</Text> to browse
            sessions
          </Text>
        </Box>

        {/* Footer hints */}
        <Box
          position="absolute"
          marginTop={dimensions.height - 3}
          marginLeft={2}
        >
          <Text color={theme.text.dim}>
            <Text color={theme.text.secondary}>Tab</Text> switch focus{" "}
            <Text color={theme.text.secondary}>↑↓</Text> navigate{" "}
            <Text color={theme.text.secondary}>Enter</Text> select{" "}
            <Text color={theme.text.secondary}>q</Text> quit
          </Text>
        </Box>
      </Box>

      {/* Sessions sidebar */}
      <Box
        width={sidebarWidth}
        height={dimensions.height}
        flexDirection="column"
        backgroundColor={theme.bg.panel}
        paddingX={1}
        paddingY={1}
      >
        <Box marginBottom={1}>
          <Text color={theme.accent.primary} bold>
            ◆ Previous Sessions
          </Text>
        </Box>

        <Box flexDirection="column" gap={0}>
          {mockSessions.map((session, idx) => {
            const isSelected = idx === selectedSession;
            return (
              <Box
                key={session.url}
                flexDirection="column"
                backgroundColor={isSelected ? theme.bg.elevated : undefined}
                paddingX={1}
                marginBottom={1}
              >
                <Box>
                  <Text
                    color={isSelected ? theme.accent.primary : theme.text.primary}
                    bold={isSelected}
                  >
                    {isSelected ? "▸ " : "  "}
                    {session.url}
                  </Text>
                </Box>
                <Box paddingLeft={2}>
                  <Text color={theme.text.dim}>{session.date}</Text>
                  <Text color={theme.text.dim}> · </Text>
                  <Text
                    color={
                      session.vulns > 5
                        ? theme.severity.critical
                        : session.vulns > 0
                          ? theme.severity.medium
                          : theme.severity.low
                    }
                  >
                    {session.vulns} vulns
                  </Text>
                </Box>
              </Box>
            );
          })}
        </Box>

        {/* Session count */}
        <Box flexGrow={1} />
        <Box>
          <Text color={theme.text.dim}>
            {mockSessions.length} sessions total
          </Text>
        </Box>
      </Box>
    </Box>
  );
}

