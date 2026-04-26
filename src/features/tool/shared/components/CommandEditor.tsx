import { theme } from "../../../../app/theme/theme";
import { ExecutionStatus } from "../types/tool-screen.types";

function getStatusColor(status: ExecutionStatus | string) {
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
  readOnly = false,
}: {
  commandInput: string;
  generatedCommand: string;
  commandSource: "generated" | "manual";
  focused: boolean;
  executionStatus: ExecutionStatus | string;
  lastExitCode: number | null;
  onCommandChange: (value: string) => void;
  onRun: () => void;
  readOnly?: boolean;
}) {
  const handleCommandChange = (value: string) => {
    if (!focused || value === commandInput) {
      return;
    }

    onCommandChange(value);
  };

  if (readOnly) {
    return (
      <box flexDirection="column" flexGrow={1}>
        <box flexDirection="row" marginBottom={1}>
          <box flexGrow={1}>
            <text fg={theme.accent.warning}>Historic preview</text>
          </box>
          <text fg={getStatusColor(executionStatus)}>
            {lastExitCode === null
              ? executionStatus
              : `${executionStatus} (${lastExitCode})`}
          </text>
        </box>

        <scrollbox
          height={2}
          focused={focused}
          scrollX={true}
          stickyScroll={false}
        >
          <box flexDirection="column">
            <text fg={theme.text.primary}>{`$ ${commandInput}`}</text>
          </box>
        </scrollbox>

        <box marginTop={1}>
          <text fg={theme.text.dim}>
            Ctrl+C exits preview. Use history Ctrl+R to rerun.
          </text>
        </box>
      </box>
    );
  }

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

      <text fg={theme.text.dim}>
        {commandSource === "manual" && commandInput !== generatedCommand
          ? "Manual command. Ctrl+G resets."
          : "Generated command synced."}
      </text>
    </box>
  );
}
