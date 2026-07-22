import { useKeyboard, useRenderer } from "@opentui/react";
import { useEffect, useState } from "react";
import { DashboardScreen } from "../features/dashboard/screen/DashboardScreen";
import { ActionDraftRecord } from "../features/action-draft/model/action-draft.types";
import { useSessionContextStore } from "../features/session/store/session-context.store";
import { ToolName } from "../features/tool/shared/types/tool-screen.types";
import { Screen } from "./routes";
import { EntryScreen } from "../features/entry/screen/EntryScreen";
import { ToolScreen } from "../features/tool/screen/ToolScreen";
import { toolWorkspaceContextService } from "../features/tool/shared/services/tool-workspace-context.service";

export function App() {
  const renderer = useRenderer();
  const [currentScreen, setCurrentScreen] = useState<Screen>({ type: "entry" });
  const createSessionForTarget = useSessionContextStore((state) => state.createSessionForTarget);
  const createSessionForNewTarget = useSessionContextStore(
    (state) => state.createSessionForNewTarget,
  );
  const openExistingSession = useSessionContextStore((state) => state.openExistingSession);

  useEffect(() => {
    toolWorkspaceContextService.clearAllActiveWorkspaces();
  }, []);

  useKeyboard((key) => {
    if (key.ctrl && key.name === "q") {
      renderer.destroy();
    }
  });

  const handleStartPentestForExistingTarget = async (target: {
    id: string;
    normalizedUrl: string;
  }) => {
    await createSessionForTarget(target);
    setCurrentScreen({
      type: "dashboard",
    });
  };

  const handleStartPentestForNewTarget = async (url: string) => {
    await createSessionForNewTarget(url);
    setCurrentScreen({
      type: "dashboard",
    });
  };

  const openSession = async (sessionId: string) => {
    if (await openExistingSession(sessionId)) {
      setCurrentScreen({
        type: "dashboard",
      });
    }
  };

  const handleSelectTool = (toolName: ToolName) => {
    setCurrentScreen({
      type: "tool",
      toolName,
      pendingActionDraftId: null,
    });
  };

  const handleSelectActionDraft = (draft: ActionDraftRecord) => {
    setCurrentScreen({
      type: "tool",
      toolName: draft.targetTool,
      pendingActionDraftId: draft.id,
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
          onStartPentestForNewTarget={handleStartPentestForNewTarget}
          onStartPentestForExistingTarget={handleStartPentestForExistingTarget}
          onOpenSession={openSession}
        />
      );

    case "dashboard":
      return (
        <DashboardScreen
          onSelectTool={handleSelectTool}
          onSelectActionDraft={handleSelectActionDraft}
          onBack={handleBackToEntry}
        />
      );

    case "tool":
      return (
        <ToolScreen
          toolName={currentScreen.toolName}
          pendingActionDraftId={currentScreen.pendingActionDraftId}
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
