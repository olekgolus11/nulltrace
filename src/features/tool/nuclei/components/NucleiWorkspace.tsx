import { useTerminalDimensions } from "@opentui/react";
import { DashboardPanel } from "../../../dashboard/components/DashboardPanel";
import { getPanelDisplayNumber } from "../../../../shared/model/panel-navigation";
import { useToolLayout } from "../../hooks/use-tool-layout";
import { CommandEditor } from "../../shared/components/CommandEditor";
import { OutputLog } from "../../shared/components/OutputLog";
import { toolPanels } from "../../shared/registry/tool-registry";
import { useNucleiWorkspace } from "../store/use-nuclei-workspace";
import { NucleiForm } from "./NucleiForm";

export function NucleiWorkspace() {
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
    toggleAuthenticatedContext,
    setActivePanel,
    setManualCommandInput,
    runCommand,
  } = useNucleiWorkspace();
  const previewLines = selectedHistoryRun
    ? [
        `$ ${selectedHistoryRun.command}`,
        "",
        ...selectedHistoryRun.logs.map((log) => log.line),
      ]
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
        title="Nuclei Controls"
        panelNumber={getPanelDisplayNumber(toolPanels, "form")}
        height={layout.formPanelHeight}
        focused={activePanel === "form"}
        onMouseDown={() => focusPanel("form")}
      >
        <NucleiForm
          form={toolData.form}
          selectedField={toolData.selectedField}
          focused={activePanel === "form"}
          onFieldChange={setField}
          authAvailable={toolData.authentication.isAvailable}
          authOrigin={toolData.authentication.origin}
          onToggleAuthenticatedContext={toggleAuthenticatedContext}
        />
      </DashboardPanel>

      <DashboardPanel
        title={"Command"}
        panelNumber={getPanelDisplayNumber(toolPanels, "command")}
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
        panelNumber={getPanelDisplayNumber(toolPanels, "output")}
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
