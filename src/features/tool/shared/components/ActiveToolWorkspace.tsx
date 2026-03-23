import { createElement } from "react";
import { DashboardPanel } from "../../../dashboard/components/DashboardPanel";
import { toolRegistry } from "../registry/tool-registry";

export function ActiveToolWorkspace({ toolId }: { toolId: string }) {
  const toolModule = toolRegistry[toolId];

  if (!toolModule) {
    return (
      <DashboardPanel title="Tool" flexGrow={1} focused={true}>
        <text>Unknown tool workspace.</text>
      </DashboardPanel>
    );
  }

  const Workspace = toolModule.Workspace;
  return createElement(Workspace);
}
