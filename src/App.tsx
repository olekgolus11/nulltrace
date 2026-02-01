import { useState } from "react";
import { useKeyboard, useRenderer } from "@opentui/react";
import { EntryScreen, DashboardScreen } from "./screens/index.ts";

type Screen =
  | { type: "entry" }
  | { type: "dashboard"; targetUrl: string }
  | { type: "tool"; toolId: string; toolName: string; targetUrl: string };

// Tool name mapping (for future use)
const toolNames: Record<string, string> = {
  nmap: "Nmap",
  nuclei: "Nuclei",
  ffuf: "FFUF",
  sqlmap: "SQLMap",
  zap: "ZAP",
  nikto: "Nikto",
};

export function App() {
  const [currentScreen, setCurrentScreen] = useState<Screen>({ type: "entry" });
  const renderer = useRenderer();

  // Global quit handler
  useKeyboard((key) => {
    if (key.name === "q") {
      renderer.destroy();
    }
  });

  const handleStartPentest = (url: string) => {
    // Normalize URL
    const normalizedUrl = url.startsWith("http") ? url : `https://${url}`;
    console.log("Starting pentest for:", normalizedUrl);
    setCurrentScreen({ type: "dashboard", targetUrl: normalizedUrl });
  };

  const handleSelectTool = (toolId: string, targetUrl: string) => {
    setCurrentScreen({
      type: "tool",
      toolId,
      toolName: toolNames[toolId] || toolId,
      targetUrl,
    });
  };

  const handleBackToDashboard = (targetUrl: string) => {
    setCurrentScreen({ type: "dashboard", targetUrl });
  };

  const handleBackToEntry = () => {
    setCurrentScreen({ type: "entry" });
  };

  switch (currentScreen.type) {
    case "entry":
      return <EntryScreen onStartPentest={handleStartPentest} />;

    case "dashboard":
      return (
        <DashboardScreen
          targetUrl={currentScreen.targetUrl}
          onSelectTool={(toolId) =>
            handleSelectTool(toolId, currentScreen.targetUrl)
          }
          onBack={handleBackToEntry}
        />
      );

    case "tool":
      // Placeholder for future ToolScreen
      return (
        <box
          flexDirection="column"
          justifyContent="center"
          alignItems="center"
          height="100%"
        >
          <text>
            <strong>Tool Screen (Coming Soon)</strong>
          </text>
          <text>
            Tool: {currentScreen.toolName} ({currentScreen.toolId})
          </text>
          <text>Press 'q' to quit</text>
        </box>
      );

    default:
      return <EntryScreen onStartPentest={handleStartPentest} />;
  }
}
