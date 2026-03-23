import { DashboardPanel } from "../../../dashboard/components/DashboardPanel";
import { useToolLayout } from "../../hooks/use-tool-layout";
import { CommandEditor } from "../../shared/components/CommandEditor";
import { OutputLog } from "../../shared/components/OutputLog";
import { useNmapWorkspace } from "../store/use-nmap-workspace";
import { NmapForm } from "./NmapForm";
import { useTerminalDimensions } from "@opentui/react";

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
    setField,
    setCommandInput,
    runCommand,
  } = useNmapWorkspace();

  return (
    <box flexDirection="column" flexGrow={1}>
      <DashboardPanel
        title="Nmap Controls"
        height={layout.formPanelHeight}
        focused={activePanel === "form"}
      >
        <NmapForm
          form={toolData.form}
          selectedField={toolData.selectedField}
          focused={activePanel === "form"}
          onFieldChange={setField}
        />
      </DashboardPanel>

      <DashboardPanel
        title="Command"
        height={layout.commandPanelHeight}
        focused={activePanel === "command"}
      >
        <CommandEditor
          commandInput={commandInput}
          generatedCommand={generatedCommand}
          commandSource={commandSource}
          focused={activePanel === "command"}
          executionStatus={executionStatus}
          lastExitCode={lastExitCode}
          onCommandChange={setCommandInput}
          onRun={() => void runCommand()}
        />
      </DashboardPanel>

      <DashboardPanel
        title="Raw Output"
        flexGrow={1}
        focused={activePanel === "output"}
      >
        <OutputLog
          lines={outputLines}
          focused={activePanel === "output"}
          height={layout.outputScrollHeight}
        />
      </DashboardPanel>
    </box>
  );
}
