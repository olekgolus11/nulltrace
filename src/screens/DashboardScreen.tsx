import { useState, useEffect } from "react";
import { Box, Text, useInput, useStdout, useFocusManager } from "ink";
import { theme } from "../theme.ts";
import { Panel } from "../components/Panel.tsx";
import { SitemapTree, mockSitemap } from "../components/SitemapTree.tsx";
import {
  VulnerabilityList,
  VulnSummary,
  mockVulnerabilities,
} from "../components/VulnerabilityList.tsx";
import { ChatMessage, ChatWindow } from "../components/ChatMessage.tsx";
import { ToolGrid } from "../components/ToolButton.tsx";
import { InlineInput } from "../components/TextInput.tsx";

interface DashboardScreenProps {
  targetUrl: string;
  onSelectTool: (toolId: string) => void;
  onBack: () => void;
}

// Mock chat messages
const mockMessages: Array<{
  type: "ai" | "user" | "system";
  content: string;
  timestamp?: string;
}> = [
  {
    type: "system",
    content: "Session started. Initiating reconnaissance...",
  },
  {
    type: "ai",
    content:
      "I've completed the initial scan of the target. Found 23 endpoints and identified several potential attack vectors.",
    timestamp: "14:32",
  },
  {
    type: "user",
    content: "What are the most critical findings?",
    timestamp: "14:33",
  },
  {
    type: "ai",
    content:
      "The most critical findings are: 1) SQL Injection vulnerability in /api/v1/users with the 'id' parameter. 2) Reflected XSS in the admin search functionality. 3) Exposed .git directory containing sensitive configuration.",
    timestamp: "14:33",
  },
  {
    type: "user",
    content: "Can you elaborate on the SQL injection?",
    timestamp: "14:34",
  },
  {
    type: "ai",
    content:
      "The /api/v1/users endpoint accepts an 'id' parameter that appears to be directly concatenated into SQL queries without parameterization. I detected this using boolean-based blind testing. The backend appears to be MySQL 8.x. Recommend running SQLMap for full exploitation analysis.",
    timestamp: "14:34",
  },
];

// Available tools
const tools = [
  { id: "nmap", label: "Nmap", icon: "⌁", description: "Port scan" },
  { id: "nuclei", label: "Nuclei", icon: "◎", description: "Vuln scan" },
  { id: "ffuf", label: "FFUF", icon: "⚡", description: "Fuzzing" },
  { id: "sqlmap", label: "SQLMap", icon: "⛁", description: "SQL inject" },
  { id: "zap", label: "ZAP", icon: "⚠", description: "Web scan" },
  { id: "nikto", label: "Nikto", icon: "☢", description: "Server scan" },
];

type FocusPanel = "sitemap" | "vulns" | "chat" | "tools";

export function DashboardScreen({
  targetUrl,
  onSelectTool,
  onBack,
}: DashboardScreenProps) {
  const { stdout } = useStdout();
  const [dimensions, setDimensions] = useState({
    width: stdout.columns || 80,
    height: stdout.rows || 24,
  });
  const [chatInput, setChatInput] = useState("");
  const [focusedPanel, setFocusedPanel] = useState<FocusPanel>("chat");
  const [selectedVuln, setSelectedVuln] = useState(0);
  const [messages, setMessages] = useState(mockMessages);

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

  // Panel cycling order
  const panelOrder: FocusPanel[] = ["sitemap", "vulns", "chat", "tools"];

  useInput((input, key) => {
    // Tab to cycle panels
    if (key.tab) {
      const currentIdx = panelOrder.indexOf(focusedPanel);
      const nextIdx = key.shift
        ? (currentIdx - 1 + panelOrder.length) % panelOrder.length
        : (currentIdx + 1) % panelOrder.length;
      setFocusedPanel(panelOrder[nextIdx]);
      return;
    }

    // Escape to go back
    if (key.escape) {
      onBack();
      return;
    }

    // Panel-specific navigation
    if (focusedPanel === "vulns") {
      if (key.upArrow) {
        setSelectedVuln((prev) => Math.max(0, prev - 1));
      }
      if (key.downArrow) {
        setSelectedVuln((prev) =>
          Math.min(mockVulnerabilities.length - 1, prev + 1)
        );
      }
    }

    // Chat input handling
    if (focusedPanel === "chat") {
      if (key.return && chatInput.trim()) {
        // Add user message
        setMessages((prev) => [
          ...prev,
          {
            type: "user" as const,
            content: chatInput,
            timestamp: new Date().toLocaleTimeString("en-US", {
              hour: "2-digit",
              minute: "2-digit",
            }),
          },
        ]);
        setChatInput("");

        // Simulate AI response
        setTimeout(() => {
          setMessages((prev) => [
            ...prev,
            {
              type: "ai" as const,
              content:
                "I understand your question. Let me analyze the target further and provide more insights...",
              timestamp: new Date().toLocaleTimeString("en-US", {
                hour: "2-digit",
                minute: "2-digit",
              }),
            },
          ]);
        }, 1000);
      }
    }
  });

  // Layout calculations
  const leftWidth = Math.floor(dimensions.width * 0.22);
  const rightWidth = Math.floor(dimensions.width * 0.2);
  const centerWidth = dimensions.width - leftWidth - rightWidth - 2;
  const topLeftHeight = Math.floor((dimensions.height - 4) * 0.55);
  const bottomLeftHeight = dimensions.height - 4 - topLeftHeight;

  return (
    <Box
      flexDirection="column"
      width={dimensions.width}
      height={dimensions.height}
      backgroundColor={theme.bg.primary}
    >
      {/* Header bar */}
      <Box
        backgroundColor={theme.bg.panel}
        paddingX={2}
        paddingY={0}
        justifyContent="space-between"
      >
        <Box>
          <Text color={theme.accent.primary} bold>
            ◆ PenTest AI
          </Text>
          <Text color={theme.text.dim}> │ </Text>
          <Text color={theme.text.secondary}>Target: </Text>
          <Text color={theme.accent.secondary} bold>
            {targetUrl}
          </Text>
        </Box>
        <Box>
          <VulnSummary vulnerabilities={mockVulnerabilities} />
        </Box>
      </Box>

      {/* Main content area */}
      <Box flexDirection="row" flexGrow={1}>
        {/* Left column - Sitemap + Vulnerabilities */}
        <Box flexDirection="column" width={leftWidth}>
          {/* Sitemap panel */}
          <Box height={topLeftHeight}>
            <Panel
              title="Sitemap"
              focused={focusedPanel === "sitemap"}
              width="100%"
              height="100%"
              padding={0}
            >
              <SitemapTree nodes={mockSitemap} maxHeight={topLeftHeight - 3} />
            </Panel>
          </Box>

          {/* Vulnerabilities panel */}
          <Box height={bottomLeftHeight}>
            <Panel
              title="Vulnerabilities"
              focused={focusedPanel === "vulns"}
              width="100%"
              height="100%"
              padding={0}
            >
              <VulnerabilityList
                vulnerabilities={mockVulnerabilities}
                selectedIndex={focusedPanel === "vulns" ? selectedVuln : -1}
                maxHeight={bottomLeftHeight - 3}
              />
            </Panel>
          </Box>
        </Box>

        {/* Center - Chat */}
        <Box width={centerWidth} flexDirection="column">
          <Panel
            title="AI Assistant"
            focused={focusedPanel === "chat"}
            width="100%"
            height="100%"
          >
            <Box flexDirection="column" height="100%">
              {/* Messages area */}
              <Box flexDirection="column" flexGrow={1} overflow="hidden">
                <ChatWindow
                  messages={messages}
                  maxHeight={dimensions.height - 10}
                />
              </Box>

              {/* Input area */}
              <Box
                borderStyle="round"
                borderColor={
                  focusedPanel === "chat"
                    ? theme.accent.primary
                    : theme.border.muted
                }
                marginTop={1}
                paddingX={1}
              >
                <InlineInput
                  value={chatInput}
                  onChange={setChatInput}
                  placeholder="Ask about vulnerabilities, request scans..."
                  focused={focusedPanel === "chat"}
                />
              </Box>
            </Box>
          </Panel>
        </Box>

        {/* Right column - Actions */}
        <Box width={rightWidth} flexDirection="column">
          <Panel
            title="Actions"
            focused={focusedPanel === "tools"}
            width="100%"
            height="100%"
          >
            <ToolGrid tools={tools} onSelect={onSelectTool} columns={2} />

            {/* Quick actions */}
            <Box flexDirection="column" marginTop={2}>
              <Text color={theme.text.muted} bold>
                Quick Actions
              </Text>
              <Box flexDirection="column" marginTop={1}>
                <Text color={theme.text.secondary}>
                  <Text color={theme.accent.primary}>r</Text> Re-scan
                </Text>
                <Text color={theme.text.secondary}>
                  <Text color={theme.accent.primary}>e</Text> Export report
                </Text>
                <Text color={theme.text.secondary}>
                  <Text color={theme.accent.primary}>s</Text> Settings
                </Text>
              </Box>
            </Box>
          </Panel>
        </Box>
      </Box>

      {/* Footer status bar */}
      <Box
        backgroundColor={theme.bg.panel}
        paddingX={2}
        justifyContent="space-between"
      >
        <Text color={theme.text.dim}>
          <Text color={theme.text.secondary}>Tab</Text> switch panel{" "}
          <Text color={theme.text.secondary}>↑↓</Text> navigate{" "}
          <Text color={theme.text.secondary}>Enter</Text> select{" "}
          <Text color={theme.text.secondary}>ESC</Text> back{" "}
          <Text color={theme.text.secondary}>q</Text> quit
        </Text>
        <Text color={theme.text.dim}>
          Panel:{" "}
          <Text color={theme.accent.primary}>
            {focusedPanel.toUpperCase()}
          </Text>
        </Text>
      </Box>
    </Box>
  );
}

