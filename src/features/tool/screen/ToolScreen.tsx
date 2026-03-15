import { useTerminalDimensions } from "@opentui/react";
import { theme } from "../../../app/theme/theme";
import { ChatWindow } from "../../chat/components/ChatWindow";
import { DashboardPanel } from "../../dashboard/components/DashboardPanel";
import { useToolLayout } from "../hooks/use-tool-layout";
import { useToolShortcuts } from "../hooks/use-tool-shortcuts";
import { ToolWorkspace } from "../components/ToolWorkspace";
import { ToolScreenProps } from "../model/tool.types";
import { Header } from "../../../shared/ui/Header";
import { StatusBar } from "../../../shared/ui/StatusBar";

export function ToolScreen({
  toolId,
  toolName,
  targetUrl,
  onBack,
}: ToolScreenProps) {
  const { width, height } = useTerminalDimensions();
  const layout = useToolLayout({ width, height });
  const {
    toolState,
    generatedCommand,
    setChatInput,
    submitChat,
    setNmapField,
    setCommandInput,
    runCommand,
  } = useToolShortcuts({
    toolId,
    targetUrl,
    onBack,
  });

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
          <DashboardPanel title="Operator Chat" flexGrow={1} focused={toolState.activePanel === "chat"}>
            <ChatWindow
              messages={toolState.chatMessages}
              inputValue={toolState.chatInput}
              onInputChange={setChatInput}
              onSubmit={submitChat}
              placeholder={`Ask about ${toolName} usage, flags, or scan strategy...`}
              focused={toolState.activePanel === "chat"}
            />
          </DashboardPanel>
        </box>

        <box
          width={layout.rightPanelWidth}
          height={layout.contentHeight}
          flexDirection="column"
        >
          <ToolWorkspace
            toolId={toolId}
            toolName={toolName}
            activePanel={toolState.activePanel}
            selectedFormField={toolState.selectedFormField}
            nmapForm={toolState.nmapForm}
            commandInput={toolState.commandInput}
            generatedCommand={generatedCommand}
            commandSource={toolState.commandSource}
            outputLines={toolState.outputLines}
            executionStatus={toolState.executionStatus}
            lastExitCode={toolState.lastExitCode}
            onNmapFieldChange={setNmapField}
            onCommandChange={setCommandInput}
            onRunCommand={runCommand}
            formHeight={layout.formPanelHeight}
            commandHeight={layout.commandPanelHeight}
            outputHeight={layout.outputScrollHeight}
          />
        </box>
      </box>

      <StatusBar
        activePanel={toolState.activePanel}
        panels={[
          { id: "chat", label: "CHAT" },
          { id: "form", label: "FORM" },
          { id: "command", label: "COMMAND" },
          { id: "output", label: "OUTPUT" },
        ]}
        hintText="Tab switch panel  Up/Down move field  Left/Right timing  Enter run/toggle  Ctrl+R run  Ctrl+G reset cmd  ESC back"
      />
    </box>
  );
}
