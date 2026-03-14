import { useState } from "react";
import { useKeyboard, useTerminalDimensions } from "@opentui/react";
import { SessionList } from "../components/index";
import { theme } from "../theme";

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
  const { width, height } = useTerminalDimensions();
  const [url, setUrl] = useState("");
  const [selectedSession, setSelectedSession] = useState(-1);
  const [focusArea, setFocusArea] = useState<"input" | "sessions">("input");

  useKeyboard((key) => {
    // Tab to switch focus areas
    if (key.name === "tab") {
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
      if (key.name === "up") {
        setSelectedSession((prev) => Math.max(0, prev - 1));
      }
      if (key.name === "down") {
        setSelectedSession((prev) =>
          Math.min(mockSessions.length - 1, prev + 1),
        );
      }
      if (key.name === "return" && selectedSession >= 0) {
        const session = mockSessions[selectedSession];
        if (session) {
          onStartPentest(session.url);
        }
      }
    }

    // Submit URL
    if (focusArea === "input" && key.name === "return" && url.trim()) {
      onStartPentest(url.trim());
    }
  });

  const sidebarWidth = 30;
  const mainWidth = width - sidebarWidth - 2;

  return (
    <box
      flexDirection="row"
      width={width}
      height={height}
      backgroundColor={theme.bg.primary}
    >
      {/* Main content area */}
      <box
        width={mainWidth}
        height={height}
        flexDirection="column"
        justifyContent="center"
        alignItems="center"
        paddingLeft={2}
        paddingRight={2}
      >
        {/* ASCII Title */}
        <box flexDirection="column" alignItems="center" marginBottom={2}>
          {titleArt.map((line, idx) => (
            <text key={`title-${idx}`} fg={theme.accent.primary}>
              {line}
            </text>
          ))}
        </box>

        {/* Subtitle */}
        <box marginBottom={2}>
          <text fg={theme.text.secondary}>
            AI-powered penetration testing assistant for web applications
          </text>
        </box>

        {/* URL Input */}
        <box flexDirection="column" alignItems="center" marginBottom={2}>
          <box marginBottom={1}>
            <text fg={theme.text.muted}>Enter target URL to begin:</text>
          </box>
          <box flexDirection="row" gap={1} alignItems="center">
            <text fg={theme.accent.primary}>
              <strong>◆</strong>
            </text>
            <input
              value={url}
              onChange={(newValue) => setUrl(newValue)}
              placeholder="https://target-website.com"
              width={50}
              focused={focusArea === "input"}
              backgroundColor={theme.bg.input}
              textColor={theme.text.primary}
              cursorColor={theme.accent.primary}
              focusedBackgroundColor={theme.bg.elevated}
              placeholderColor={theme.text.dim}
            />
          </box>
        </box>

        {/* Start button hint */}
        <box marginTop={1}>
          <text fg={theme.text.dim}>
            Press{" "}
            <span fg={theme.accent.primary}>
              <strong>Enter</strong>
            </span>{" "}
            to start pentest or{" "}
            <span fg={theme.accent.primary}>
              <strong>Tab</strong>
            </span>{" "}
            to browse sessions
          </text>
        </box>

        {/* Footer hints */}
        <box position="absolute" marginTop={height - 3} marginLeft={2}>
          <text fg={theme.text.dim}>
            <span fg={theme.text.secondary}>
              <strong>Tab</strong>
            </span>{" "}
            switch focus{" "}
            <span fg={theme.text.secondary}>
              <strong>↑↓</strong>
            </span>{" "}
            navigate{" "}
            <span fg={theme.text.secondary}>
              <strong>Enter</strong>
            </span>{" "}
            select
          </text>
        </box>
      </box>

      {/* Sessions sidebar */}
      <box
        width={sidebarWidth}
        height={height}
        flexDirection="column"
        backgroundColor={theme.bg.panel}
        paddingLeft={2}
        paddingRight={2}
        paddingTop={1}
        paddingBottom={1}
      >
        <SessionList sessions={mockSessions} selectedIndex={selectedSession} />
      </box>
    </box>
  );
}
