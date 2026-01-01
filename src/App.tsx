import { useState } from "react";
import { useApp, useInput } from "ink";
import { EntryScreen, DashboardScreen, ToolScreen } from "./screens/index.ts";

type Screen =
  | { type: "entry" }
  | { type: "dashboard"; targetUrl: string }
  | { type: "tool"; toolId: string; toolName: string; targetUrl: string };

// Tool name mapping
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
  const { exit } = useApp();

  // Global quit handler
  useInput((input) => {
    if (input === "q") {
      exit();
    }
  });

  const handleStartPentest = (url: string) => {
    // Normalize URL
    const normalizedUrl = url.startsWith("http") ? url : `https://${url}`;
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
      return (
        <ToolScreen
          toolId={currentScreen.toolId}
          toolName={currentScreen.toolName}
          onBack={() => handleBackToDashboard(currentScreen.targetUrl)}
        />
      );

    default:
      return <EntryScreen onStartPentest={handleStartPentest} />;
  }
}
