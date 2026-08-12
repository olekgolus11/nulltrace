import { useTerminalDimensions } from "@opentui/react";
import { theme } from "../../../../app/theme/theme";
import { DashboardPanel } from "../../../dashboard/components/DashboardPanel";
import { useToolLayout } from "../../hooks/use-tool-layout";
import { CommandEditor } from "../../shared/components/CommandEditor";
import { OutputLog } from "../../shared/components/OutputLog";
import { useCurlWorkspace } from "../store/use-curl-workspace";
import { CurlForm } from "./CurlForm";

export function CurlWorkspace() {
  const dimensions = useTerminalDimensions();
  const layout = useToolLayout(dimensions);
  const state = useCurlWorkspace();
  const previewLines = state.selectedHistoryRun
    ? [
        `$ ${state.selectedHistoryRun.command}`,
        "",
        ...state.selectedHistoryRun.logs.map((log) => log.line),
      ]
    : state.outputLines;
  const previewCommand = state.selectedHistoryRun?.command ?? state.commandInput;
  const focus = (panel: typeof state.activePanel) => {
    if (!state.isHelpOpen) state.setActivePanel(panel);
  };

  return (
    <box flexDirection="column" flexGrow={1}>
      <DashboardPanel
        title="cURL Request Controls"
        height={layout.formPanelHeight}
        focused={state.activePanel === "form"}
        onMouseDown={() => focus("form")}
      >
        <CurlForm
          toolData={state.toolData}
          focused={state.activePanel === "form"}
          onFieldChange={state.setField}
          onSelectField={state.selectField}
          onCycleMethod={state.cycleMethod}
          onCycleBodyMode={state.cycleBodyMode}
          onToggleAuthenticatedContext={state.toggleAuthenticatedContext}
        />
      </DashboardPanel>
      <DashboardPanel
        title="Command"
        isHistoricPreview={state.isHistoricPreview}
        height={layout.commandPanelHeight}
        focused={state.activePanel === "command"}
        onMouseDown={() => focus("command")}
      >
        <CommandEditor
          commandInput={previewCommand}
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
        title="Bounded Response"
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
      <text fg={theme.text.dim}>
        Enter runs the selected command. Response limit: 2 MiB; timeout: 30 seconds.
      </text>
    </box>
  );
}
