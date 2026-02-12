import { useState } from "react";
import { useKeyboard, useTerminalDimensions } from "@opentui/react";
import {
  Header,
  Panel,
  StatusBar,
  ChatWindow,
  VulnerabilityList,
  VulnerabilityCounts,
} from "../components/index.ts";
import {
  SitemapTree,
  buildTree,
  flattenTree,
} from "../components/SitemapTree.tsx";
import { theme } from "../theme.ts";

interface DashboardScreenProps {
  targetUrl: string;
  onSelectTool: (toolId: string, targetUrl: string) => void;
  onBack: () => void;
}

// Mock data
const mockSitemapFlat = [
  { path: "/", status: 200, method: "GET" },
  { path: "/admin", status: 403, method: "GET" },
  { path: "/admin/login", status: 200, method: "POST" },
  { path: "/admin/dashboard", status: 401, method: "GET" },
  { path: "/admin/users", status: 401, method: "GET" },
  { path: "/api", status: 200, method: "GET" },
  { path: "/api/v1", status: 200, method: "GET" },
  { path: "/api/v1/users", status: 200, method: "GET" },
  { path: "/api/v1/prod", status: 200, method: "GET" },
  { path: "/api/v1/orders", status: 201, method: "POST" },
  { path: "/api/v2", status: 200, method: "GET" },
  { path: "/api/v2/users", status: 200, method: "GET" },
  { path: "/api/v2/prod", status: 200, method: "GET" },
  { path: "/api/v2/orderssssssss", status: 201, method: "POST" },
  { path: "/api/health", status: 200, method: "GET" },
  { path: "/shop", status: 200, method: "GET" },
  { path: "/shop/products", status: 200, method: "GET" },
  { path: "/shop/cart", status: 200, method: "GET" },
  { path: "/shop/checkout", status: 200, method: "POST" },
  { path: "/about", status: 200, method: "GET" },
  { path: "/contact", status: 200, method: "GET" },
  { path: "/robots.txt", status: 200, method: "GET" },
  { path: "/.git", status: 403, method: "GET" },
];

const mockSitemapTree = buildTree(mockSitemapFlat);
const mockSitemapFlatNodes = flattenTree(mockSitemapTree);

const mockVulnerabilities = [
  {
    id: "1",
    severity: "critical" as const,
    title: "Reflected XSS",
    path: "/admin/search?q=",
  },
  {
    id: "2",
    severity: "critical" as const,
    title: "SQL Injection",
    path: "/api/v1/users?id=",
  },
  {
    id: "3",
    severity: "high" as const,
    title: "CSRF Missing Token",
    path: "/shop/checkout",
  },
  {
    id: "4",
    severity: "medium" as const,
    title: "Directory Listing",
    path: "/uploads/",
  },
  {
    id: "5",
    severity: "medium" as const,
    title: "Sensitive Data Exposure",
    path: "/.git/config",
  },
  {
    id: "6",
    severity: "low" as const,
    title: "Missing Security Headers",
    path: "/",
  },
  {
    id: "7",
    severity: "info" as const,
    title: "Outdated jQuery",
    path: "/js/jquery-1.12.4.min.js",
  },
];

const mockChatMessages = [
  {
    id: "1",
    sender: "system" as const,
    content: "Session started. Initiating reconnaissance...",
    timestamp: "14:32",
  },
  {
    id: "2",
    sender: "ai" as const,
    content:
      "I've completed the initial scan of the target. Found 23 endpoints and identified several potential attack vectors.",
    timestamp: "14:32",
  },
  {
    id: "3",
    sender: "user" as const,
    content: "What are the most critical findings?",
    timestamp: "14:33",
  },
  {
    id: "4",
    sender: "ai" as const,
    content:
      "The most critical findings are: 1) SQL Injection vulnerability in /api/v1/users with the 'id' parameter. 2) Reflected XSS in the admin search functionality. 3) Exposed .git directory containing sensitive configuration.",
    timestamp: "14:33",
  },
  {
    id: "5",
    sender: "user" as const,
    content: "Can you elaborate on the SQL injection?",
    timestamp: "14:34",
  },
  {
    id: "6",
    sender: "ai" as const,
    content:
      "The /api/v1/users endpoint accepts an 'id' parameter that appears to be directly concatenated into SQL queries without parameterization. I detected this using boolean-based blind testing. The backend appears to be MySQL 8.x. Recommend running SQLMap for full exploitation analysis.",
    timestamp: "14:34",
  },
];

const tools = [
  { id: "nmap", name: "Nmap", description: "Port scan", icon: "🔍" },
  { id: "nuclei", name: "Nuclei", description: "Vuln scan", icon: "🎯" },
  { id: "ffuf", name: "FFUF", description: "Fuzzing", icon: "🌪️" },
  { id: "sqlmap", name: "SQLMap", description: "SQL Inject", icon: "💉" },
  { id: "zap", name: "ZAP", description: "Web scan", icon: "⚡" },
  { id: "nikto", name: "Nikto", description: "Server scan", icon: "🛡️" },
];

export function DashboardScreen({
  targetUrl,
  onSelectTool,
  onBack,
}: DashboardScreenProps) {
  const { width, height } = useTerminalDimensions();

  // Focus management
  const [activePanel, setActivePanel] = useState<
    "sitemap" | "vulns" | "chat" | "tools"
  >("chat");

  // Selection states
  const [selectedTool, setSelectedTool] = useState(0);
  const [selectedSitemapItem, setSelectedSitemapItem] = useState(0);
  const [selectedVulnItem, setSelectedVulnItem] = useState(0);

  // Chat state
  const [chatInput, setChatInput] = useState("");

  useKeyboard((key) => {
    // Back to entry screen
    if (key.name === "escape") {
      onBack();
      return;
    }

    // Tab to cycle through panels
    if (key.name === "tab") {
      const panels: Array<"sitemap" | "vulns" | "chat" | "tools"> = [
        "sitemap",
        "vulns",
        "chat",
        "tools",
      ];
      const currentIndex = panels.indexOf(activePanel);
      const nextIndex = (currentIndex + 1) % panels.length;
      const nextPanel = panels[nextIndex];
      if (nextPanel) {
        setActivePanel(nextPanel);
      }
      return;
    }

    // Handle navigation based on active panel
    switch (activePanel) {
      case "tools":
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
        break;

      case "sitemap":
        if (key.name === "up") {
          setSelectedSitemapItem((prev) => Math.max(0, prev - 1));
        }
        if (key.name === "down") {
          setSelectedSitemapItem((prev) =>
            Math.min(mockSitemapFlatNodes.length - 1, prev + 1),
          );
        }
        break;

      case "vulns":
        if (key.name === "up") {
          setSelectedVulnItem((prev) => Math.max(0, prev - 1));
        }
        if (key.name === "down") {
          setSelectedVulnItem((prev) =>
            Math.min(mockVulnerabilities.length - 1, prev + 1),
          );
        }
        break;

      case "chat":
        if (key.name === "return" && chatInput.trim()) {
          // Handle chat submit
          setChatInput("");
        }
        break;
    }
  });

  const leftPanelWidth = 40;
  const rightPanelWidth = 40;
  const centerPanelWidth = width - leftPanelWidth - rightPanelWidth - 2;
  const headerHeight = 3;
  const statusBarHeight = 1;
  const contentHeight = height - headerHeight - statusBarHeight;

  // Calculate scrollbox dimensions for left panels.
  // Both Sitemap and Vulns panels split the left column evenly (flexGrow=1).
  // Each gets roughly half of contentHeight.
  const leftPanelHalf = Math.floor(contentHeight / 2);

  // Sitemap panel: border=2 rows, padding=0, internal "Sitemap" title=1 row
  // scrollbox height = half - border(2) - title(1)
  const sitemapScrollHeight = Math.max(1, leftPanelHalf - 2);
  // Sitemap panel: border=2 cols, padding=0
  const sitemapScrollWidth = Math.max(1, leftPanelWidth - 2);

  // Vulns panel: border=2 rows, paddingTop=1+paddingBottom=1, title row=1+marginBottom=1
  // scrollbox height = half - border(2) - padding(2) - title+margin(2)
  const vulnsScrollHeight = Math.max(1, leftPanelHalf - 2 - 2 - 2);
  // Vulns panel: border=2 cols, paddingLeft=1+paddingRight=1
  const vulnsScrollWidth = Math.max(1, leftPanelWidth - 2 - 2);

  return (
    <box
      flexDirection="column"
      width={width}
      height={height}
      backgroundColor={theme.bg.primary}
    >
      <Header targetUrl={targetUrl} showControls={false} />
      <box flexDirection="row" height={contentHeight}>
        <box
          width={leftPanelWidth}
          height={contentHeight}
          flexDirection="column"
        >
          <Panel
            flexGrow={1}
            focused={activePanel === "sitemap"}
            paddingLeft={0}
            paddingRight={0}
            paddingTop={0}
            paddingBottom={0}
          >
            <scrollbox
              height={sitemapScrollHeight}
              width={sitemapScrollWidth}
              focused={activePanel === "sitemap"}
              scrollX={true}
            >
              <SitemapTree
                nodes={mockSitemapTree}
                selectedIndex={selectedSitemapItem}
                focused={activePanel === "sitemap"}
              />
            </scrollbox>
          </Panel>

          <Panel
            title="Vulnerabilities"
            flexGrow={1}
            focused={activePanel === "vulns"}
          >
            <scrollbox
              height={vulnsScrollHeight}
              width={vulnsScrollWidth}
              focused={activePanel === "vulns"}
            >
              <VulnerabilityList
                vulnerabilities={mockVulnerabilities}
                selectedIndex={selectedVulnItem}
                focused={activePanel === "vulns"}
              />
            </scrollbox>
          </Panel>
        </box>
        <box
          width={centerPanelWidth}
          height={contentHeight}
          flexDirection="column"
        >
          <Panel
            title="AI Assistant"
            flexGrow={1}
            focused={activePanel === "chat"}
          >
            <ChatWindow
              messages={mockChatMessages}
              inputValue={chatInput}
              onInputChange={setChatInput}
              onSubmit={() => {}}
              focused={activePanel === "chat"}
            />
          </Panel>
        </box>
        <box
          width={rightPanelWidth}
          height={contentHeight}
          flexDirection="column"
        >
          <Panel title="Tools" flexGrow={1} focused={activePanel === "tools"}>
            <box marginBottom={2}>
              <box flexDirection="column" gap={1}>
                {tools.map((tool, idx) => {
                  const isSelected =
                    idx === selectedTool && activePanel === "tools";
                  return (
                    <box
                      key={tool.id}
                      flexDirection="column"
                      backgroundColor={
                        isSelected ? theme.bg.elevated : undefined
                      }
                      paddingLeft={1}
                      paddingTop={1}
                      paddingBottom={1}
                      border={isSelected}
                      borderColor={
                        isSelected ? theme.accent.primary : undefined
                      }
                    >
                      <text
                        fg={
                          isSelected ? theme.accent.primary : theme.text.primary
                        }
                      >
                        {isSelected ? <strong>{tool.name}</strong> : tool.name}
                      </text>
                      <text fg={theme.text.dim}>{tool.description}</text>
                    </box>
                  );
                })}
              </box>
            </box>
            <box flexDirection="column">
              <box marginBottom={1}>
                <text fg={theme.accent.primary}>
                  <strong>Quick Actions</strong>
                </text>
              </box>
              <box flexDirection="column" gap={0}>
                <text fg={theme.text.secondary}>r Re-scan</text>
                <text fg={theme.text.secondary}>e Export report</text>
                <text fg={theme.text.secondary}>s Settings</text>
              </box>
            </box>
          </Panel>
        </box>
      </box>

      <StatusBar activePanel={activePanel} />
    </box>
  );
}
