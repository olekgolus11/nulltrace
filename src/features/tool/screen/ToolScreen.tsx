import { useEffect } from "react";
import { useTerminalDimensions } from "@opentui/react";
import { theme } from "../../../app/theme/theme";
import { ChatWindow } from "../../chat/components/ChatWindow";
import { DashboardPanel } from "../../dashboard/components/DashboardPanel";
import { useToolLayout } from "../hooks/use-tool-layout";
import { ToolScreenProps } from "../shared/types/tool-screen.types";
import { Header } from "../../../shared/ui/Header";
import { StatusBar } from "../../../shared/ui/StatusBar";
import { useToolWorkspaceStore } from "../shared/store/tool-workspace.store";
import { useToolKeyboardNavigation } from "../shared/hooks/use-tool-keyboard-navigation";
import { ActiveToolWorkspace } from "../shared/components/ActiveToolWorkspace";
import { toolPanels } from "../shared/registry/tool-registry";

export function ToolScreen({
  toolId,
  toolName,
  targetUrl,
  onBack,
}: ToolScreenProps) {
  const { width, height } = useTerminalDimensions();
  const layout = useToolLayout({ width, height });
  const activePanel = useToolWorkspaceStore((state) => state.activePanel);
  const chatMessages = useToolWorkspaceStore((state) => state.chatMessages);
  const chatInput = useToolWorkspaceStore((state) => state.chatInput);
  const setChatInput = useToolWorkspaceStore((state) => state.setChatInput);
  const submitChat = useToolWorkspaceStore((state) => state.submitChat);
  const initializeWorkspace = useToolWorkspaceStore(
    (state) => state.initializeWorkspace,
  );
  const stopCommand = useToolWorkspaceStore((state) => state.stopCommand);

  useToolKeyboardNavigation(onBack);

  useEffect(() => {
    initializeWorkspace(toolId, targetUrl);

    return () => {
      stopCommand();
    };
  }, [initializeWorkspace, stopCommand, targetUrl, toolId]);

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
          <ActiveToolWorkspace toolId={toolId} />
        </box>
      </box>

      <StatusBar
        activePanel={activePanel}
        panels={toolPanels}
        hintText="Tab switch panel  Up/Down move field  Left/Right timing  Enter run/toggle  Ctrl+R run  Ctrl+G reset cmd  ESC back"
      />
    </box>
  );
}
