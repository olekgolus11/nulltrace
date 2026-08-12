import { useTerminalDimensions } from "@opentui/react";
import { theme } from "../../../../app/theme/theme";
import { DashboardPanel } from "../../../dashboard/components/DashboardPanel";
import { useToolLayout } from "../../hooks/use-tool-layout";
import { CommandEditor } from "../../shared/components/CommandEditor";
import { OutputLog } from "../../shared/components/OutputLog";
import { useNmapWorkspace } from "../store/use-nmap-workspace";
import { NmapForm } from "./NmapForm";

export function NmapWorkspace() {
  const { width, height } = useTerminalDimensions();
  const layout = useToolLayout({ width, height });
  const {
    activePanel,
    toolData,
    commandInput,
    generatedCommand,
    commandSource,
    executionStatus,
    lastExitCode,
    outputLines,
    selectedHistoryRun,
    isHistoricPreview,
    isHelpOpen,
    setField,
    setActivePanel,
    setManualCommandInput,
    runCommand,
  } = useNmapWorkspace();
  const previewLines = selectedHistoryRun
    ? [`$ ${selectedHistoryRun.command}`, "", ...selectedHistoryRun.logs.map((log) => log.line)]
    : outputLines;
  const previewStatus = selectedHistoryRun?.status ?? executionStatus;
  const previewExitCode = selectedHistoryRun?.exitCode ?? lastExitCode;
  const previewCommand = selectedHistoryRun?.command ?? commandInput;
  const focusPanel = (panel: typeof activePanel) => {
    if (isHelpOpen) {
      return;
    }

    setActivePanel(panel);
  };

  return (
    <box flexDirection="column" flexGrow={1}>
      <DashboardPanel
        title="Nmap Controls"
        height={layout.formPanelHeight}
        focused={activePanel === "form"}
        onMouseDown={() => focusPanel("form")}
      >
        <NmapForm
          form={toolData.form}
          selectedField={toolData.selectedField}
          focused={activePanel === "form"}
          onFieldChange={setField}
        />
      </DashboardPanel>

      <DashboardPanel
        title={"Command"}
        isHistoricPreview={isHistoricPreview}
        height={layout.commandPanelHeight}
        focused={activePanel === "command"}
        onMouseDown={() => focusPanel("command")}
      >
        <CommandEditor
          commandInput={previewCommand}
          generatedCommand={generatedCommand}
          commandSource={commandSource}
          focused={activePanel === "command"}
          executionStatus={previewStatus}
          lastExitCode={previewExitCode}
          onCommandChange={setManualCommandInput}
          onRun={() => void runCommand()}
          readOnly={isHistoricPreview}
        />
      </DashboardPanel>

      <DashboardPanel
        title={"Raw Output"}
        isHistoricPreview={isHistoricPreview}
        flexGrow={1}
        focused={activePanel === "output"}
        onMouseDown={() => focusPanel("output")}
      >
        <OutputLog
          lines={previewLines}
          focused={activePanel === "output"}
          height={layout.outputScrollHeight}
        />
      </DashboardPanel>
    </box>
  );
}
