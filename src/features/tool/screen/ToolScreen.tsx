import { useTerminalDimensions } from "@opentui/react";
import { useEffect } from "react";
import { theme } from "../../../app/theme/theme";
import { Header } from "../../../shared/ui/Header";
import { StatusBar } from "../../../shared/ui/StatusBar";
import { ChatWindow } from "../../chat/components/ChatWindow";
import { DashboardPanel } from "../../dashboard/components/DashboardPanel";
import { useSessionContextStore } from "../../session/store/session-context.store";
import { useToolLayout } from "../hooks/use-tool-layout";
import { ActiveToolWorkspace } from "../shared/components/ActiveToolWorkspace";
import { ToolHelpDialog } from "../shared/components/ToolHelpDialog";
import { useToolKeyboardNavigation } from "../shared/hooks/use-tool-keyboard-navigation";
import { toolPanels, toolRegistry } from "../shared/registry/tool-registry";
import { useToolWorkspaceStore } from "../shared/store/tool-workspace.store";
import {
  ToolData,
  ToolName,
  ToolScreenProps,
} from "../shared/types/tool-screen.types";

function getToolData(
  toolName: ToolName,
  targetUrl: string,
  toolData: unknown,
): ToolData {
  return (
    (toolData as ToolData | null) ??
    toolRegistry[toolName].createInitialToolData(targetUrl)
  );
}

export function ToolScreen({ toolName, onBack }: ToolScreenProps) {
  const { width, height } = useTerminalDimensions();
  const sessionId = useSessionContextStore((state) => state.sessionId);
  const targetUrl = useSessionContextStore((state) => state.targetUrl);
  const layout = useToolLayout({ width, height });
  const activePanel = useToolWorkspaceStore((state) => state.activePanel);
  const chatMessages = useToolWorkspaceStore((state) => state.chatMessages);
  const chatInput = useToolWorkspaceStore((state) => state.chatInput);
  const setChatInput = useToolWorkspaceStore((state) => state.setChatInput);
  const submitChat = useToolWorkspaceStore((state) => state.submitChat);
  const isHelpOpen = useToolWorkspaceStore((state) => state.isHelpOpen);
  const initializeWorkspace = useToolWorkspaceStore(
    (state) => state.initializeWorkspace,
  );
  const stopCommand = useToolWorkspaceStore((state) => state.stopCommand);
  const toolData = useToolWorkspaceStore((state) =>
    getToolData(toolName, targetUrl, state.toolData),
  );

  useToolKeyboardNavigation(onBack);

  useEffect(() => {
    if (!sessionId || !targetUrl) {
      return;
    }

    initializeWorkspace(toolName, targetUrl, sessionId);

    return () => {
      stopCommand();
    };
  }, [initializeWorkspace, sessionId, stopCommand, targetUrl, toolName]);

  return (
    <box
      flexDirection="column"
      width={width}
      height={height}
      backgroundColor={theme.bg.primary}
    >
      <Header
        title={`${toolName} Workspace`}
        subtitle="guided controls + raw command"
        targetUrl={targetUrl}
      />

      <box flexDirection="row" height={layout.contentHeight}>
        <box
          width={layout.leftPanelWidth}
          height={layout.contentHeight}
          flexDirection="column"
        >
          <DashboardPanel
            title="Operator Chat"
            flexGrow={1}
            focused={activePanel === "chat"}
          >
            <ChatWindow
              messages={chatMessages}
              inputValue={chatInput}
              onInputChange={setChatInput}
              onSubmit={submitChat}
              placeholder={`Ask about ${toolName} usage, flags, or scan strategy...`}
              focused={activePanel === "chat"}
            />
          </DashboardPanel>
        </box>

        <box
          width={layout.rightPanelWidth}
          height={layout.contentHeight}
          flexDirection="column"
        >
          <ActiveToolWorkspace toolName={toolName} />
        </box>
      </box>

      {isHelpOpen && Number.isFinite(toolData.selectedField) ? (
        <ToolHelpDialog toolName={toolName} fieldId={toolData.selectedField} />
      ) : null}

      <StatusBar
        activePanel={activePanel}
        panels={toolPanels}
        hintText="Tab switch panel  Up/Down move field  Enter run/toggle  Ctrl+H help  Ctrl+R run  Ctrl+C cancel  Ctrl+G reset cmd  ESC back  Ctrl+Q quit"
      />
    </box>
  );
}
