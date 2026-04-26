import { NmapWorkspace } from "../../nmap/components/NmapWorkspace";
import {
  nmapBooleanFields,
  nmapFieldOrder,
} from "../../nmap/config/nmap.config";
import { nmapHelpContent } from "../../nmap/data/nmap-help";
import { nmapCommandService } from "../../nmap/services/nmap-command.service";
import { NmapFieldId, NmapToolData } from "../../nmap/types/nmap.types";
import {
  ToolHelpContent,
  ToolModule,
  ToolName,
  ToolPanel,
} from "../types/tool-screen.types";

export const toolRegistry: Record<string, ToolModule> = {
  nmap: {
    id: "nmap",
    name: "Nmap",
    description: "Network mapper with guided scan profiles and manual control.",
    Workspace: NmapWorkspace,
    createInitialToolData: (targetUrl: string) =>
      nmapCommandService.createInitialToolData(targetUrl),
    buildGeneratedCommand: (toolData: unknown) =>
      nmapCommandService.buildCommand(toolData as NmapToolData),
    handleFormKey: (key, state, api) => {
      if (state.activePanel !== "form") {
        return false;
      }

      const toolData = state.toolData as NmapToolData;
      if (!toolData) {
        return false;
      }

      if (key.ctrl && key.name === "h") {
        api.toggleHelp();
        return true;
      }

      if (key.name === "up") {
        api.updateToolData((current) =>
          nmapCommandService.moveSelection(
            current as NmapToolData,
            -1,
            nmapFieldOrder.length - 1,
          ),
        );
        return true;
      }

      if (key.name === "down") {
        api.updateToolData((current) =>
          nmapCommandService.moveSelection(
            current as NmapToolData,
            1,
            nmapFieldOrder.length - 1,
          ),
        );
        return true;
      }

      const timingFieldSelected = toolData.selectedField === 2;
      if (timingFieldSelected && key.name === "left") {
        api.updateToolData((current) =>
          nmapCommandService.cycleTiming(current as NmapToolData, -1),
        );
        api.syncGeneratedCommand();
        return true;
      }

      if (timingFieldSelected && key.name === "right") {
        api.updateToolData((current) =>
          nmapCommandService.cycleTiming(current as NmapToolData, 1),
        );
        api.syncGeneratedCommand();
        return true;
      }

      const selectedField = nmapFieldOrder[toolData.selectedField];

      if (
        selectedField &&
        nmapBooleanFields.includes(selectedField) &&
        (key.name === "return" || key.name === "enter" || key.name === "space")
      ) {
        api.updateToolData((current) =>
          nmapCommandService.toggleBooleanField(
            current as NmapToolData,
            selectedField as NmapFieldId,
          ),
        );
        api.syncGeneratedCommand();
        return true;
      }

      return false;
    },
  },
};

export const toolPanels: Array<{ id: ToolPanel; label: string }> = [
  { id: "chat", label: "CHAT" },
  { id: "form", label: "FORM" },
  { id: "command", label: "COMMAND" },
  { id: "output", label: "OUTPUT" },
  { id: "history", label: "HISTORY" },
];

export const helpContent: Record<
  ToolName,
  Record<string, ToolHelpContent> | null
> = {
  nmap: nmapHelpContent,
  nuclei: null,
  ffuf: null,
  sqlmap: null,
  zap: null,
  nikto: null,
};
