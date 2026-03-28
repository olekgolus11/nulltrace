import { useState } from "react";
import { DashboardScreen } from "../features/dashboard/screen/DashboardScreen";
import { sessionRepository } from "../features/session/services/session.repository";
import { normalizeTargetUrl } from "../features/session/services/session-url";
import { ToolName } from "../features/tool/shared/types/tool-screen.types";
import { Screen } from "./routes";
import { EntryScreen } from "../features/entry/screen/EntryScreen";
import { ToolScreen } from "../features/tool/screen/ToolScreen";

export function App() {
  const [currentScreen, setCurrentScreen] = useState<Screen>({ type: "entry" });

  const handleStartPentest = (url: string) => {
    const { normalizedUrl, displayUrl } = normalizeTargetUrl(url);
    const target = sessionRepository.findOrCreateTarget(
      normalizedUrl,
      displayUrl,
    );
    const session = sessionRepository.createSession(target.id);

    setCurrentScreen({
      type: "dashboard",
      sessionId: session.id,
      targetUrl: target.displayUrl,
    });
  };

  const handleOpenSession = (sessionId: string) => {
    const session = sessionRepository.getSessionById(sessionId);
    if (!session) {
      return;
    }

    sessionRepository.touchSessionActivity(session.id);

    setCurrentScreen({
      type: "dashboard",
      sessionId: session.id,
      targetUrl: session.displayUrl,
    });
  };

  const handleSelectTool = (
    toolName: ToolName,
    targetUrl: string,
    sessionId: string,
  ) => {
    setCurrentScreen({
      type: "tool",
      toolName,
      sessionId,
      targetUrl,
    });
  };

  const handleBackToEntry = () => {
    setCurrentScreen({ type: "entry" });
  };

  const handleBackToDashboard = (targetUrl: string, sessionId: string) => {
    setCurrentScreen({ type: "dashboard", targetUrl, sessionId });
  };

  switch (currentScreen.type) {
    case "entry":
      return (
        <EntryScreen
          onStartPentest={handleStartPentest}
          onOpenSession={handleOpenSession}
        />
      );

    case "dashboard":
      return (
        <DashboardScreen
          sessionId={currentScreen.sessionId}
          targetUrl={currentScreen.targetUrl}
          onSelectTool={(toolName) =>
            handleSelectTool(
              toolName,
              currentScreen.targetUrl,
              currentScreen.sessionId,
            )
          }
          onBack={handleBackToEntry}
        />
      );

    case "tool":
      return (
        <ToolScreen
          toolName={currentScreen.toolName}
          sessionId={currentScreen.sessionId}
          targetUrl={currentScreen.targetUrl}
          onBack={() =>
            handleBackToDashboard(
              currentScreen.targetUrl,
              currentScreen.sessionId,
            )
          }
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
