import { useTerminalDimensions } from "@opentui/react";
import { theme } from "../../../../app/theme/theme";
import { DashboardPanel } from "../../../dashboard/components/DashboardPanel";
import { getPanelDisplayNumber } from "../../../../shared/model/panel-navigation";
import { useToolLayout } from "../../hooks/use-tool-layout";
import { CommandEditor } from "../../shared/components/CommandEditor";
import { OutputLog } from "../../shared/components/OutputLog";
import { toolPanels } from "../../shared/registry/tool-registry";
import { useNiktoWorkspace } from "../store/use-nikto-workspace";
import { NiktoForm } from "./NiktoForm";

export function NiktoWorkspace() {
  const dimensions = useTerminalDimensions();
  const layout = useToolLayout(dimensions);
  const state = useNiktoWorkspace();
  const previewLines = state.selectedHistoryRun
    ? [
        `$ ${state.selectedHistoryRun.command}`,
        "",
        ...state.selectedHistoryRun.logs.map((log) => log.line),
      ]
    : state.outputLines;
  const focus = (panel: typeof state.activePanel) => {
    if (!state.isHelpOpen) state.setActivePanel(panel);
  };

  return (
    <box flexDirection="column" flexGrow={1}>
      <DashboardPanel
        title="Nikto Standard Controls"
        panelNumber={getPanelDisplayNumber(toolPanels, "form")}
        height={layout.formPanelHeight}
        focused={state.activePanel === "form"}
        onMouseDown={() => focus("form")}
      >
        <NiktoForm
          form={state.toolData.form}
          selectedField={state.toolData.selectedField}
          focused={state.activePanel === "form"}
          onFieldChange={state.setField}
        />
      </DashboardPanel>
      <DashboardPanel
        title="Command"
        panelNumber={getPanelDisplayNumber(toolPanels, "command")}
        isHistoricPreview={state.isHistoricPreview}
        height={layout.commandPanelHeight}
        focused={state.activePanel === "command"}
        onMouseDown={() => focus("command")}
      >
        <CommandEditor
          commandInput={state.selectedHistoryRun?.command ?? state.commandInput}
          generatedCommand={state.generatedCommand}
          commandSource={state.commandSource}
          focused={state.activePanel === "command"}
          executionStatus={state.selectedHistoryRun?.status ?? state.executionStatus}
          lastExitCode={state.selectedHistoryRun?.exitCode ?? state.lastExitCode}
          onCommandChange={state.setManualCommandInput}
          onRun={() => void state.runCommand()}
          readOnly={state.isHistoricPreview}
        />
      </DashboardPanel>
      <DashboardPanel
        title="Raw Output"
        panelNumber={getPanelDisplayNumber(toolPanels, "output")}
        isHistoricPreview={state.isHistoricPreview}
        flexGrow={1}
        focused={state.activePanel === "output"}
        onMouseDown={() => focus("output")}
      >
        <OutputLog
          lines={previewLines}
          focused={state.activePanel === "output"}
          height={layout.outputScrollHeight}
        />
      </DashboardPanel>
      <text fg={theme.text.dim}>Enter runs selected command. Review before execution.</text>
    </box>
  );
}
