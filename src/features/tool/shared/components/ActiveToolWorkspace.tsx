import { createElement } from "react";
import { DashboardPanel } from "../../../dashboard/components/DashboardPanel";
import { toolRegistry } from "../registry/tool-registry";

export function ActiveToolWorkspace({ toolName }: { toolName: string }) {
  const toolModule = toolRegistry[toolName];

  if (!toolModule) {
    return (
      <DashboardPanel title="Tool" flexGrow={1} focused={true}>
        <text fg={theme.text.secondary}>
          Tool workspace not available for "{toolName}".
        </text>
      </DashboardPanel>
    );
  }

  const Workspace = toolModule.Workspace;
  return createElement(Workspace);
}
