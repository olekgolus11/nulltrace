import { NmapWorkspace } from "../../nmap/components/NmapWorkspace";
import { nmapBooleanFields, nmapFieldOrder } from "../../nmap/config/nmap.config";
import { nmapCommandService } from "../../nmap/services/nmap-command.service";
import { NmapFieldId, NmapToolData } from "../../nmap/types/nmap.types";
import { NucleiWorkspace } from "../../nuclei/components/NucleiWorkspace";
import { nucleiFieldOrder } from "../../nuclei/config/nuclei.config";
import { nucleiCommandService } from "../../nuclei/services/nuclei-command.service";
import { NucleiToolData } from "../../nuclei/types/nuclei.types";
import { PanelDefinition } from "../../../../shared/model/panel-navigation.types";
import {
  ToolHelpContent,
  ToolModule,
  ToolName,
  ToolPanel,
  ToolPrepareCommand,
  ToolRunCompleted,
} from "../types/tool-screen.types";
import { scannerCatalog } from "./scanner-catalog";

export const toolRegistry: Record<string, ToolModule> = {
  nmap: {
    id: scannerCatalog.nmap.id,
    name: scannerCatalog.nmap.name,
    description: scannerCatalog.nmap.description ?? "",
    Workspace: NmapWorkspace,
    createInitialToolData: (targetUrl: string) =>
      nmapCommandService.createInitialToolData(targetUrl),
    buildGeneratedCommand: (toolData: unknown) =>
      nmapCommandService.buildCommand(toolData as NmapToolData),
    prepareCommandForRun: (options: ToolPrepareCommand) =>
      nmapCommandService.prepareCommandForRun(options),
    collectArtifacts: (options: ToolRunCompleted) => nmapCommandService.collectArtifacts(options),
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
          nmapCommandService.moveSelection(current as NmapToolData, -1, nmapFieldOrder.length - 1),
        );
        return true;
      }

      if (key.name === "down") {
        api.updateToolData((current) =>
          nmapCommandService.moveSelection(current as NmapToolData, 1, nmapFieldOrder.length - 1),
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
        api.updateToolData((current) => nmapCommandService.cycleTiming(current as NmapToolData, 1));
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
  nuclei: {
    id: scannerCatalog.nuclei.id,
    name: scannerCatalog.nuclei.name,
    description: scannerCatalog.nuclei.description ?? "",
    Workspace: NucleiWorkspace,
    createInitialToolData: (targetUrl: string) =>
      nucleiCommandService.createInitialToolData(targetUrl),
    buildGeneratedCommand: (toolData: unknown) =>
      nucleiCommandService.buildCommand(toolData as NucleiToolData),
    prepareCommandForRun: (options: ToolPrepareCommand) =>
      nucleiCommandService.prepareCommandForRun(options),
    redactCommandForPersistence: (command: string) =>
      nucleiCommandService.redactCommandForPersistence(command),
    collectArtifacts: (options: ToolRunCompleted) => nucleiCommandService.collectArtifacts(options),
    handleFormKey: (key, state, api) => {
      if (state.activePanel !== "form") {
        return false;
      }

      const toolData = state.toolData as NucleiToolData;
      if (!toolData) {
        return false;
      }

      if (key.ctrl && key.name === "h") {
        api.toggleHelp();
        return true;
      }

      if (key.name === "up") {
        api.updateToolData((current) =>
          nucleiCommandService.moveSelection(
            current as NucleiToolData,
            -1,
            toolData.authentication.isAvailable
              ? nucleiFieldOrder.length - 1
              : nucleiFieldOrder.length - 2,
          ),
        );
        return true;
      }

      if (key.name === "down") {
        api.updateToolData((current) =>
          nucleiCommandService.moveSelection(
            current as NucleiToolData,
            1,
            toolData.authentication.isAvailable
              ? nucleiFieldOrder.length - 1
              : nucleiFieldOrder.length - 2,
          ),
        );
        return true;
      }

      const selectedField = nucleiFieldOrder[toolData.selectedField];
      if (
        nucleiCommandService.isAuthenticationFieldSelected(selectedField) &&
        (key.name === "left" || key.name === "right")
      ) {
        api.updateToolData((current) =>
          nucleiCommandService.toggleAuthenticatedContext(current as NucleiToolData),
        );
        api.syncGeneratedCommand();
        return true;
      }

      if (nucleiCommandService.isSeverityFieldSelected(selectedField) && key.name === "left") {
        api.updateToolData((current) =>
          nucleiCommandService.cycleSeverity(current as NucleiToolData, -1),
        );
        api.syncGeneratedCommand();
        return true;
      }

      if (nucleiCommandService.isSeverityFieldSelected(selectedField) && key.name === "right") {
        api.updateToolData((current) =>
          nucleiCommandService.cycleSeverity(current as NucleiToolData, 1),
        );
        api.syncGeneratedCommand();
        return true;
      }

      return false;
    },
  },
};

export const toolPanels: Array<PanelDefinition<ToolPanel>> = [
  { id: "drafts", label: "DRAFTS" },
  { id: "chat", label: "CHAT" },
  { id: "form", label: "FORM" },
  { id: "command", label: "COMMAND" },
  { id: "output", label: "OUTPUT" },
  { id: "history", label: "HISTORY" },
];

export const helpContent: Record<ToolName, Record<string, ToolHelpContent> | null> = {
  nmap: scannerCatalog.nmap.helpContent as Record<string, ToolHelpContent>,
  nuclei: scannerCatalog.nuclei.helpContent as Record<string, ToolHelpContent>,
  ffuf: scannerCatalog.ffuf.helpContent,
  sqlmap: scannerCatalog.sqlmap.helpContent,
  zap: scannerCatalog.zap.helpContent,
  nikto: scannerCatalog.nikto.helpContent,
};
