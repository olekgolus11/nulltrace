import { useState } from "react";
import { DashboardScreen } from "../features/dashboard/screen/DashboardScreen";
import { tools } from "../features/dashboard/data/tool-catalog";
import { Screen } from "./routes";
import { EntryScreen } from "../features/entry/screen/EntryScreen";
import { ToolScreen } from "../features/tool/screen/ToolScreen";

export function App() {
  const [currentScreen, setCurrentScreen] = useState<Screen>({ type: "entry" });

  const handleStartPentest = (url: string) => {
    const normalizedUrl = url.startsWith("http") ? url : `https://${url}`;
    setCurrentScreen({ type: "dashboard", targetUrl: normalizedUrl });
  };

  const handleSelectTool = (toolId: string, targetUrl: string) => {
    setCurrentScreen({
      type: "tool",
      toolId,
      toolName: tools.find((t) => t.id === toolId)?.name || toolId,
      targetUrl,
    });
  };

  const handleBackToEntry = () => {
    setCurrentScreen({ type: "entry" });
  };

  const handleBackToDashboard = (targetUrl: string) => {
    setCurrentScreen({ type: "dashboard", targetUrl });
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
          targetUrl={currentScreen.targetUrl}
          onBack={() => handleBackToDashboard(currentScreen.targetUrl)}
        />
      );

    default:
      return (
        <box>
          <text>
            <strong>Unknown Screen</strong>
          </text>
        </box>
      );
  }
}
