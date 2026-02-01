import { useState } from "react";
import { useKeyboard, useTerminalDimensions } from "@opentui/react";
import { theme } from "../theme.ts";

interface DashboardScreenProps {
  targetUrl: string;
  onSelectTool: (toolId: string, targetUrl: string) => void;
  onBack: () => void;
}

// Mock data for the dashboard
const mockVulnerabilities = {
  critical: 2,
  high: 5,
  medium: 8,
  low: 12,
  info: 15,
  total: 42,
};

const mockSitemap = [
  { path: "/", status: 200, type: "HTML" },
  { path: "/api", status: 200, type: "JSON" },
  { path: "/login", status: 200, type: "HTML" },
  { path: "/admin", status: 403, type: "HTML" },
  { path: "/api/users", status: 200, type: "JSON" },
  { path: "/api/auth", status: 401, type: "JSON" },
  { path: "/assets", status: 200, type: "DIR" },
  { path: "/robots.txt", status: 200, type: "TEXT" },
];

const tools = [
  { id: "nmap", name: "Nmap", description: "Port scanning & service detection", icon: "🔍" },
  { id: "nuclei", name: "Nuclei", description: "Vulnerability scanner", icon: "🎯" },
  { id: "ffuf", name: "FFUF", description: "Fuzzing & directory discovery", icon: "🌪️" },
  { id: "sqlmap", name: "SQLMap", description: "SQL injection testing", icon: "💉" },
  { id: "zap", name: "ZAP", description: "Web application scanner", icon: "⚡" },
  { id: "nikto", name: "Nikto", description: "Web server scanner", icon: "🛡️" },
];

export function DashboardScreen({
  targetUrl,
  onSelectTool,
  onBack,
}: DashboardScreenProps) {
  const { width, height } = useTerminalDimensions();
  const [selectedTool, setSelectedTool] = useState(0);
  const [selectedSitemapItem, setSelectedSitemapItem] = useState(0);
  const [focusArea, setFocusArea] = useState<"tools" | "sitemap">("tools");

  useKeyboard((key) => {
    // Back to entry screen
    if (key.name === "escape") {
      onBack();
      return;
    }

    // Tab to switch focus areas
    if (key.name === "tab") {
      setFocusArea((prev) => (prev === "tools" ? "sitemap" : "tools"));
      return;
    }

    // Handle tool navigation
    if (focusArea === "tools") {
      if (key.name === "up") {
        setSelectedTool((prev) => Math.max(0, prev - 1));
      }
      if (key.name === "down") {
        setSelectedTool((prev) => Math.min(tools.length - 1, prev + 1));
      }
      if (key.name === "return") {
        const tool = tools[selectedTool];
        if (tool) {
          onSelectTool(tool.id, targetUrl);
        }
      }
    }

    // Handle sitemap navigation
    if (focusArea === "sitemap") {
      if (key.name === "up") {
        setSelectedSitemapItem((prev) => Math.max(0, prev - 1));
      }
      if (key.name === "down") {
        setSelectedSitemapItem((prev) =>
          Math.min(mockSitemap.length - 1, prev + 1),
        );
      }
    }
  });

  const sidebarWidth = 35;
  const mainWidth = width - sidebarWidth - 1;
  const headerHeight = 3;
  const vulnPanelHeight = 8;
  const contentHeight = height - headerHeight - 1;

  return (
    <box
      flexDirection="column"
      width={width}
      height={height}
      backgroundColor={theme.bg.primary}
    >
      {/* Header */}
      <box
        height={headerHeight}
        flexDirection="row"
        alignItems="center"
        paddingLeft={2}
        paddingRight={2}
        backgroundColor={theme.bg.panel}
      >
        <box flexGrow={1}>
          <text>
            <span fg={theme.accent.primary}>
              <strong>◆ PenTest AI</strong>
            </span>
            <span fg={theme.text.dim}> | </span>
            <span fg={theme.text.primary}>Target: </span>
            <span fg={theme.accent.secondary}>{targetUrl}</span>
          </text>
        </box>
        <box>
          <text fg={theme.text.dim}>
            <span fg={theme.text.secondary}>
              <strong>ESC</strong>
            </span>{" "}
            back{" "}
            <span fg={theme.text.secondary}>
              <strong>Tab</strong>
            </span>{" "}
            switch{" "}
            <span fg={theme.text.secondary}>
              <strong>q</strong>
            </span>{" "}
            quit
          </text>
        </box>
      </box>

      {/* Main content */}
      <box flexDirection="row" height={contentHeight}>
        {/* Left panel - Vuln summary + Sitemap */}
        <box
          width={mainWidth}
          height={contentHeight}
          flexDirection="column"
          paddingLeft={2}
          paddingRight={2}
          paddingTop={1}
        >
          {/* Vulnerability Summary Panel */}
          <box
            flexDirection="column"
            marginBottom={2}
            border
            borderColor={theme.border.default}
            paddingLeft={2}
            paddingRight={2}
            paddingTop={1}
            paddingBottom={1}
          >
            <box marginBottom={1}>
              <text fg={theme.accent.primary}>
                <strong>◆ Vulnerability Summary</strong>
              </text>
            </box>
            <box flexDirection="row" gap={4}>
              <box>
                <text fg={theme.severity.critical}>
                  <strong>CRITICAL: {mockVulnerabilities.critical}</strong>
                </text>
              </box>
              <box>
                <text fg={theme.severity.high}>
                  <strong>HIGH: {mockVulnerabilities.high}</strong>
                </text>
              </box>
              <box>
                <text fg={theme.severity.medium}>
                  <strong>MED: {mockVulnerabilities.medium}</strong>
                </text>
              </box>
              <box>
                <text fg={theme.severity.low}>
                  <strong>LOW: {mockVulnerabilities.low}</strong>
                </text>
              </box>
              <box>
                <text fg={theme.severity.info}>
                  <strong>INFO: {mockVulnerabilities.info}</strong>
                </text>
              </box>
              <box flexGrow={1} />
              <box>
                <text fg={theme.text.secondary}>
                  <strong>TOTAL: {mockVulnerabilities.total}</strong>
                </text>
              </box>
            </box>
          </box>

          {/* Sitemap Panel */}
          <box
            flexDirection="column"
            flexGrow={1}
            border
            borderColor={
              focusArea === "sitemap" ? theme.accent.primary : theme.border.default
            }
            paddingLeft={2}
            paddingRight={2}
            paddingTop={1}
            paddingBottom={1}
          >
            <box marginBottom={1}>
              <text fg={theme.accent.primary}>
                <strong>◆ Discovered URLs</strong>
                <span fg={theme.text.dim}> ({mockSitemap.length} found)</span>
              </text>
            </box>
            <box flexDirection="column" gap={0}>
              {mockSitemap.map((item, idx) => {
                const isSelected = idx === selectedSitemapItem && focusArea === "sitemap";
                const statusColor =
                  item.status >= 400
                    ? theme.severity.critical
                    : item.status >= 300
                      ? theme.accent.warning
                      : theme.severity.low;
                return (
                  <box
                    key={item.path}
                    flexDirection="row"
                    backgroundColor={isSelected ? theme.bg.elevated : undefined}
                    paddingLeft={1}
                    paddingRight={1}
                  >
                    <box width={20}>
                      <text
                        fg={isSelected ? theme.accent.primary : theme.text.primary}
                      >
                        {isSelected ? <strong>▸ {item.path}</strong> : `  ${item.path}`}
                      </text>
                    </box>
                    <box width={8}>
                      <text fg={statusColor}>{item.status}</text>
                    </box>
                    <box>
                      <text fg={theme.text.dim}>{item.type}</text>
                    </box>
                  </box>
                );
              })}
            </box>
          </box>
        </box>

        {/* Right sidebar - Tools */}
        <box
          width={sidebarWidth}
          height={contentHeight}
          flexDirection="column"
          backgroundColor={theme.bg.panel}
          paddingLeft={1}
          paddingRight={1}
          paddingTop={1}
          paddingBottom={1}
        >
          <box marginBottom={1}>
            <text fg={theme.accent.primary}>
              <strong>◆ Security Tools</strong>
            </text>
          </box>

          <box flexDirection="column" gap={1}>
            {tools.map((tool, idx) => {
              const isSelected = idx === selectedTool && focusArea === "tools";
              return (
                <box
                  key={tool.id}
                  flexDirection="column"
                  backgroundColor={isSelected ? theme.bg.elevated : undefined}
                  paddingLeft={1}
                  paddingRight={1}
                  paddingTop={1}
                  paddingBottom={1}
                  border={isSelected}
                  borderColor={isSelected ? theme.accent.primary : undefined}
                >
                  <box flexDirection="row" gap={1} alignItems="center">
                    <text>{tool.icon}</text>
                    <text
                      fg={isSelected ? theme.accent.primary : theme.text.primary}
                    >
                      {isSelected ? <strong>{tool.name}</strong> : tool.name}
                    </text>
                  </box>
                  <box paddingLeft={3}>
                    <text fg={theme.text.dim}>{tool.description}</text>
                  </box>
                </box>
              );
            })}
          </box>

          <box flexGrow={1} />
          <box marginTop={1}>
            <text fg={theme.text.dim}>
              <span fg={theme.text.secondary}>
                <strong>↑↓</strong>
              </span>{" "}
              navigate{" "}
              <span fg={theme.text.secondary}>
                <strong>Enter</strong>
              </span>{" "}
              run
            </text>
          </box>
        </box>
      </box>
    </box>
  );
}
