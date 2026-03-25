import { useState } from "react";
import { DashboardScreen } from "../features/dashboard/screen/DashboardScreen";
import { ToolName } from "../features/tool/shared/types/tool-screen.types";
import { Screen } from "./routes";
import { EntryScreen } from "../features/entry/screen/EntryScreen";
import { ToolScreen } from "../features/tool/screen/ToolScreen";

export function App() {
  const [currentScreen, setCurrentScreen] = useState<Screen>({ type: "entry" });

  const handleStartPentest = (url: string) => {
    const normalizedUrl = url.startsWith("http") ? url : `https://${url}`;
    setCurrentScreen({ type: "dashboard", targetUrl: normalizedUrl });
  };

  const handleSelectTool = (toolName: ToolName, targetUrl: string) => {
    setCurrentScreen({
      type: "tool",
      toolName,
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
          onSelectTool={(toolName) =>
            handleSelectTool(toolName, currentScreen.targetUrl)
          }
          onBack={handleBackToEntry}
        />
      );

    case "tool":
      return (
        <ToolScreen
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
