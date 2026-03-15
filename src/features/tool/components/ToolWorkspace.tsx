import { DashboardPanel } from "../../dashboard/components/DashboardPanel";
import { CommandEditor } from "./CommandEditor";
import { NmapForm } from "./NmapForm";
import { OutputLog } from "./OutputLog";
import { ToolWorkspaceProps } from "../model/tool.types";

export function ToolWorkspace({
  toolId,
  toolName,
  activePanel,
  selectedFormField,
  nmapForm,
  commandInput,
  generatedCommand,
  commandSource,
  outputLines,
  executionStatus,
  lastExitCode,
  onNmapFieldChange,
  onCommandChange,
  onRunCommand,
  formHeight,
  commandHeight,
  outputHeight,
}: ToolWorkspaceProps) {
  if (toolId !== "nmap") {
    return (
      <DashboardPanel title={toolName} flexGrow={1} focused={activePanel === "form"}>
        <text>This tool does not have a dedicated TUI yet.</text>
      </DashboardPanel>
    );
  }

  return (
    <box flexDirection="column" flexGrow={1}>
      <DashboardPanel
        title={`${toolName} Controls`}
        height={formHeight}
        marginBottom={1}
        focused={activePanel === "form"}
      >
        <NmapForm
          form={nmapForm}
          selectedField={selectedFormField}
          focused={activePanel === "form"}
          onFieldChange={onNmapFieldChange}
        />
      </DashboardPanel>

      <DashboardPanel
        title="Command"
        height={commandHeight}
        marginBottom={1}
        focused={activePanel === "command"}
      >
        <CommandEditor
          commandInput={commandInput}
          generatedCommand={generatedCommand}
          commandSource={commandSource}
          focused={activePanel === "command"}
          executionStatus={executionStatus}
          lastExitCode={lastExitCode}
          onCommandChange={onCommandChange}
          onRun={onRunCommand}
        />
      </DashboardPanel>

      <DashboardPanel title="Raw Output" flexGrow={1} focused={activePanel === "output"}>
        <OutputLog
          lines={outputLines}
          focused={activePanel === "output"}
          height={outputHeight}
        />
      </DashboardPanel>
    </box>
  );
}
