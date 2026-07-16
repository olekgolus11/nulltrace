import { ScrollBoxRenderable } from "@opentui/core";
import { RefObject } from "react";
import { theme } from "../../../../app/theme/theme";
import { DashboardPanel } from "../../../dashboard/components/DashboardPanel";
import { ToolRunSummary } from "../../../session/model/session.repository.types";
import { getPanelDisplayNumber } from "../../../../shared/model/panel-navigation";
import { toolPanels } from "../registry/tool-registry";

function formatRunTime(value: string) {
  return new Date(value).toLocaleTimeString([], {
    hour: "2-digit",
    minute: "2-digit",
  });
}

function formatCommand(command: string) {
  return command.length > 28 ? `${command.slice(0, 25)}...` : command;
}

function getStatusColor(status: string) {
  switch (status) {
    case "success":
      return theme.accent.low;
    case "running":
    case "cancelled":
      return theme.accent.warning;
    case "error":
      return theme.accent.critical;
    default:
      return theme.text.dim;
  }
}

export function ToolRunHistoryPanel({
  runs,
  selectedRunId,
  focused,
  scrollRef,
  onMouseDown,
}: {
  runs: ToolRunSummary[];
  selectedRunId: string | null;
  focused: boolean;
  scrollRef: RefObject<ScrollBoxRenderable | null>;
  onMouseDown?: () => void;
}) {
  return (
    <DashboardPanel
      title="Run History"
      panelNumber={getPanelDisplayNumber(toolPanels, "history")}
      flexGrow={1}
      focused={focused}
      onMouseDown={onMouseDown}
    >
      <box flexDirection="column" flexGrow={1}>
        {runs.length === 0 ? (
          <text fg={theme.text.dim}>No previous runs for this tool in this session.</text>
        ) : (
          <scrollbox ref={scrollRef} flexGrow={1} stickyScroll={false}>
            <box flexDirection="column">
              {runs.map((run) => {
                const isSelected = run.id === selectedRunId;
                return (
                  <box
                    key={run.id}
                    flexDirection="column"
                    paddingLeft={1}
                    paddingRight={1}
                    backgroundColor={isSelected && focused ? theme.bg.elevated : undefined}
                    borderColor={
                      isSelected && focused ? theme.accent.primary : theme.border.default
                    }
                  >
                    <box flexDirection="row">
                      <box flexGrow={1}>
                        <text fg={isSelected ? theme.text.primary : theme.text.secondary}>
                          {formatRunTime(run.startedAt)}
                        </text>
                      </box>
                      <text fg={getStatusColor(run.status)}>
                        {run.exitCode === null ? run.status : `${run.status} (${run.exitCode})`}
                      </text>
                    </box>
                    <text fg={isSelected && focused ? theme.accent.primary : theme.text.primary}>
                      {formatCommand(run.command)}
                    </text>
                  </box>
                );
              })}
            </box>
          </scrollbox>
        )}

        <box marginTop={1}>
          <text fg={theme.text.dim}>Enter preview. Ctrl+R rerun.</text>
        </box>
      </box>
    </DashboardPanel>
  );
}
