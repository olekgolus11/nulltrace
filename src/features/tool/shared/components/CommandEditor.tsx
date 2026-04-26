import { theme } from "../../../../app/theme/theme";
import { ExecutionStatus } from "../types/tool-screen.types";

function getStatusColor(status: ExecutionStatus) {
  switch (status) {
    case "running":
      return theme.accent.warning;
    case "success":
      return theme.accent.low;
    case "cancelled":
      return theme.accent.warning;
    case "error":
      return theme.accent.critical;
    default:
      return theme.text.dim;
  }
}

export function CommandEditor({
  commandInput,
  generatedCommand,
  commandSource,
  focused,
  executionStatus,
  lastExitCode,
  onCommandChange,
  onRun,
}: {
  commandInput: string;
  generatedCommand: string;
  commandSource: "generated" | "manual";
  focused: boolean;
  executionStatus: ExecutionStatus;
  lastExitCode: number | null;
  onCommandChange: (value: string) => void;
  onRun: () => void;
}) {
  const handleCommandChange = (value: string) => {
    if (!focused || value === commandInput) {
      return;
    }

    onCommandChange(value);
  };

  return (
    <box flexDirection="column" flexGrow={1}>
      <box flexDirection="row" marginBottom={1}>
        <box flexGrow={1}>
          <text fg={theme.text.secondary}>
            Mode:{" "}
            <span
              fg={
                commandSource === "manual"
                  ? theme.accent.warning
                  : theme.accent.primary
              }
            >
              {commandSource === "manual" ? "manual" : "generated"}
            </span>
          </text>
        </box>
        <text fg={getStatusColor(executionStatus)}>
          {executionStatus === "running"
            ? "running"
            : lastExitCode === null
              ? executionStatus
              : `${executionStatus} (${lastExitCode})`}
        </text>
      </box>

      <box
        flexDirection="row"
        alignItems="center"
        marginBottom={1}
        width="100%"
      >
        <box width={2} flexShrink={0}>
          <text fg={theme.accent.primary}>{">"}</text>
        </box>
        <box flexGrow={1} minWidth={0}>
          <input
            value={commandInput}
            onInput={handleCommandChange}
            onChange={handleCommandChange}
            width="100%"
            onSubmit={onRun}
            placeholder="tool command"
            focused={focused}
            backgroundColor={theme.bg.input}
            textColor={theme.text.primary}
            cursorColor={theme.accent.primary}
            focusedBackgroundColor={theme.bg.elevated}
            placeholderColor={theme.text.dim}
          />
        </box>
      </box>

      <box marginBottom={1}>
        <text fg={theme.text.dim}>
          Enter submits. Ctrl+R runs. Ctrl+C cancels. Ctrl+G restores the
          generated command.
        </text>
      </box>

      {commandSource === "manual" && commandInput !== generatedCommand ? (
        <text fg={theme.text.dim}>Generated: {generatedCommand}</text>
      ) : (
        <text fg={theme.text.dim}>
          Generated command stays in sync with the form.
        </text>
      )}
    </box>
  );
}
