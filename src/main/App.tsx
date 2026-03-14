import { useState } from "react";
import { DashboardScreen } from "../features/dashboard/screen/DashboardScreen";
import { tools } from "../features/dashboard/data/tool-catalog";
import { Screen } from "./routes";
import { EntryScreen } from "../features/entry/screen/EntryScreen";

export function App() {
  const [currentScreen, setCurrentScreen] = useState<Screen>({ type: "entry" });

  const handleStartPentest = (url: string) => {
    const normalizedUrl = url.startsWith("http") ? url : `https://${url}`;
    console.log("Starting pentest for:", normalizedUrl);
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
      return (
        <box>
          <text>
            <strong>Unknown Screen</strong>
          </text>
        </box>
      );
  }
}
