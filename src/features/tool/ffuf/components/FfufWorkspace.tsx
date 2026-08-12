import { useTerminalDimensions } from "@opentui/react";
import { DashboardPanel } from "../../../dashboard/components/DashboardPanel";
import { useToolLayout } from "../../hooks/use-tool-layout";
import { CommandEditor } from "../../shared/components/CommandEditor";
import { OutputLog } from "../../shared/components/OutputLog";
import { useFfufWorkspace } from "../store/use-ffuf-workspace";
import { FfufForm } from "./FfufForm";

export function FfufWorkspace() {
  const { width, height } = useTerminalDimensions();
  const layout = useToolLayout({ width, height });
  const workspace = useFfufWorkspace();
  const previewLines = workspace.selectedHistoryRun
    ? [
        `$ ${workspace.selectedHistoryRun.command}`,
        "",
        ...workspace.selectedHistoryRun.logs.map((log) => log.line),
      ]
    : workspace.outputLines;
  const previewStatus = workspace.selectedHistoryRun?.status ?? workspace.executionStatus;
  const previewExitCode = workspace.selectedHistoryRun?.exitCode ?? workspace.lastExitCode;
  const previewCommand = workspace.selectedHistoryRun?.command ?? workspace.commandInput;
  const focusPanel = (panel: typeof workspace.activePanel) => {
    if (!workspace.isHelpOpen) workspace.setActivePanel(panel);
  };
  const modeTitle =
    workspace.toolData.mode === "parameter_discovery"
      ? "Parameter Discovery"
      : workspace.toolData.mode === "value_fuzzing"
        ? "Value Fuzzing"
        : "Content Discovery";

  return (
    <box flexDirection="column" flexGrow={1}>
      <DashboardPanel
        title={`FFUF ${modeTitle}`}
        height={layout.formPanelHeight}
        focused={workspace.activePanel === "form"}
        onMouseDown={() => focusPanel("form")}
      >
        <FfufForm
          toolData={workspace.toolData}
          focused={workspace.activePanel === "form"}
          onFieldChange={workspace.setField}
          onToggleAuthenticatedContext={workspace.toggleAuthenticatedContext}
        />
      </DashboardPanel>
      <DashboardPanel
        title="Command"
        isHistoricPreview={workspace.isHistoricPreview}
        height={layout.commandPanelHeight}
        focused={workspace.activePanel === "command"}
        onMouseDown={() => focusPanel("command")}
      >
        <CommandEditor
          commandInput={previewCommand}
          generatedCommand={workspace.generatedCommand}
          commandSource={workspace.commandSource}
          focused={workspace.activePanel === "command"}
          executionStatus={previewStatus}
          lastExitCode={previewExitCode}
          onCommandChange={workspace.setManualCommandInput}
          onRun={() => void workspace.runCommand()}
          readOnly={workspace.isHistoricPreview}
        />
      </DashboardPanel>
      <DashboardPanel
        title="Raw Output"
        isHistoricPreview={workspace.isHistoricPreview}
        flexGrow={1}
        focused={workspace.activePanel === "output"}
        onMouseDown={() => focusPanel("output")}
      >
        <OutputLog lines={previewLines} focused={workspace.activePanel === "output"} height={layout.outputScrollHeight} />
      </DashboardPanel>
    </box>
  );
}
