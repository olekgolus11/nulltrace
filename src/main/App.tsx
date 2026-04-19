import { useState } from "react";
import { DashboardScreen } from "../features/dashboard/screen/DashboardScreen";
import { sessionRepository } from "../features/session/services/session.repository";
import { normalizeTargetUrl } from "../features/session/services/session-url";
import { useSessionContextStore } from "../features/session/store/session-context.store";
import { ToolName } from "../features/tool/shared/types/tool-screen.types";
import { Screen } from "./routes";
import { EntryScreen } from "../features/entry/screen/EntryScreen";
import { ToolScreen } from "../features/tool/screen/ToolScreen";

export function App() {
  const [currentScreen, setCurrentScreen] = useState<Screen>({ type: "entry" });
  const setCurrentSession = useSessionContextStore(
    (state) => state.setCurrentSession,
  );

  const openNewSessionForTarget = (target: {
    id: string;
    displayUrl: string;
  }) => {
    const session = sessionRepository.createSession(target.id);

    setCurrentSession({
      sessionId: session.id,
      targetId: target.id,
      targetUrl: target.displayUrl,
    });

    setCurrentScreen({
      type: "dashboard",
    });
  };

  const handleStartPentest = (url: string) => {
    const { normalizedUrl, displayUrl } = normalizeTargetUrl(url);
    const target = sessionRepository.findOrCreateTarget(
      normalizedUrl,
      displayUrl,
    );
    openNewSessionForTarget(target);
  };

  const handleOpenSession = (sessionId: string) => {
    const session = sessionRepository.getSessionById(sessionId);
    if (!session) {
      return;
    }

    sessionRepository.touchSessionActivity(session.id);

    setCurrentSession({
      sessionId: session.id,
      targetId: session.targetId,
      targetUrl: session.displayUrl,
    });

    setCurrentScreen({
      type: "dashboard",
    });
  };

  const handleSelectTool = (toolName: ToolName) => {
    setCurrentScreen({
      type: "tool",
      toolName,
    });
  };

  const handleBackToEntry = () => {
    setCurrentScreen({ type: "entry" });
  };

  const handleBackToDashboard = () => {
    setCurrentScreen({ type: "dashboard" });
  };

  switch (currentScreen.type) {
    case "entry":
      return (
        <EntryScreen
          onStartPentest={handleStartPentest}
          onOpenSession={handleOpenSession}
          onCreateSessionFromTarget={openNewSessionForTarget}
        />
      );

    case "dashboard":
      return (
        <DashboardScreen
          onSelectTool={handleSelectTool}
          onBack={handleBackToEntry}
        />
      );

    case "tool":
      return (
        <ToolScreen
          toolName={currentScreen.toolName}
          onBack={handleBackToDashboard}
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
