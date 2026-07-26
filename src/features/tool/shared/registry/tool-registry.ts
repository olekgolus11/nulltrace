import { NmapWorkspace } from "../../nmap/components/NmapWorkspace";
import { nmapBooleanFields, nmapFieldOrder } from "../../nmap/config/nmap.config";
import { nmapCommandService } from "../../nmap/services/nmap-command.service";
import { NmapFieldId, NmapToolData } from "../../nmap/types/nmap.types";
import { NucleiWorkspace } from "../../nuclei/components/NucleiWorkspace";
import { nucleiFieldOrder } from "../../nuclei/config/nuclei.config";
import { nucleiCommandService } from "../../nuclei/services/nuclei-command.service";
import { NucleiToolData } from "../../nuclei/types/nuclei.types";
import { FfufWorkspace } from "../../ffuf/components/FfufWorkspace";
import { getFfufFieldOrder } from "../../ffuf/config/ffuf.config";
import {
  buildFfufCommand,
  collectFfufArtifacts,
  createInitialFfufToolData,
  cycleFfufMode,
  cycleFfufRequestLocation,
  isFfufBooleanField,
  isFfufRequestLocationField,
  moveFfufFieldSelection,
  prepareFfufCommandForRun,
  toggleFfufBooleanField,
} from "../../ffuf/services/ffuf-command.helpers";
import { FfufToolData } from "../../ffuf/types/ffuf.types";
import { NiktoWorkspace } from "../../nikto/components/NiktoWorkspace";
import { niktoCommandService } from "../../nikto/services/nikto-command.service";
import { NiktoToolData } from "../../nikto/types/nikto.types";
import { ffufSitemapEnrichmentService } from "../../../sitemap/services/ffuf-sitemap-enrichment.service";
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
  ffuf: {
    id: scannerCatalog.ffuf.id,
    name: scannerCatalog.ffuf.name,
    description: scannerCatalog.ffuf.description ?? "",
    Workspace: FfufWorkspace,
    createInitialToolData: (targetUrl: string) => createInitialFfufToolData(targetUrl),
    buildGeneratedCommand: (toolData: unknown) =>
      buildFfufCommand(toolData as FfufToolData),
    prepareCommandForRun: (options: ToolPrepareCommand) => prepareFfufCommandForRun(options),
    collectArtifacts: (options: ToolRunCompleted) => collectFfufArtifacts(options),
    processSavedArtifacts: ({ sessionId, artifacts }) => {
      if (sessionId) ffufSitemapEnrichmentService.upsertContentDiscoveryResults(sessionId, artifacts);
    },
    handleFormKey: (key, state, api) => {
      if (state.activePanel !== "form") return false;

      const toolData = state.toolData as FfufToolData;
      if (!toolData) return false;

      if (key.ctrl && key.name === "h") {
        api.toggleHelp();
        return true;
      }
      if (key.name === "up") {
        api.updateToolData((current) =>
          moveFfufFieldSelection(current as FfufToolData, -1),
        );
        return true;
      }
      if (key.name === "down") {
        api.updateToolData((current) =>
          moveFfufFieldSelection(current as FfufToolData, 1),
        );
        return true;
      }

      const selectedField = getFfufFieldOrder(toolData.mode)[toolData.selectedField];
      if (selectedField === "mode" && (key.name === "left" || key.name === "right")) {
        api.updateToolData((current) =>
          cycleFfufMode(current as FfufToolData, key.name === "left" ? -1 : 1),
        );
        api.syncGeneratedCommand();
        return true;
      }
      if (
        (toolData.mode === "parameter_discovery" || toolData.mode === "value_fuzzing") &&
        isFfufRequestLocationField(selectedField) &&
        (key.name === "left" || key.name === "right")
      ) {
        api.updateToolData((current) =>
          cycleFfufRequestLocation(
            current as Extract<FfufToolData, { mode: "parameter_discovery" | "value_fuzzing" }>,
            key.name === "left" ? -1 : 1,
          ),
        );
        api.syncGeneratedCommand();
        return true;
      }
      if (
        toolData.mode === "content_discovery" &&
        selectedField &&
        isFfufBooleanField(selectedField) &&
        (key.name === "return" || key.name === "enter" || key.name === "space")
      ) {
        api.updateToolData((current) =>
          toggleFfufBooleanField(
            current as Extract<FfufToolData, { mode: "content_discovery" }>,
            selectedField,
          ),
        );
        api.syncGeneratedCommand();
        return true;
      }

      return false;
    },
  },
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
  nikto: {
    id: scannerCatalog.nikto.id,
    name: scannerCatalog.nikto.name,
    description: scannerCatalog.nikto.description ?? "",
    Workspace: NiktoWorkspace,
    createInitialToolData: (targetUrl: string) =>
      niktoCommandService.createInitialToolData(targetUrl),
    buildGeneratedCommand: (toolData: unknown) =>
      niktoCommandService.buildCommand(toolData as NiktoToolData),
    prepareCommandForRun: (options: ToolPrepareCommand) =>
      niktoCommandService.prepareCommandForRun(options),
    collectArtifacts: (options: ToolRunCompleted) =>
      niktoCommandService.collectArtifacts(options),
    handleFormKey: (key, state, api) => {
      if (state.activePanel !== "form") return false;
      if (key.name === "up" || key.name === "down") {
        api.updateToolData((current) =>
          niktoCommandService.moveSelection(
            current as NiktoToolData,
            key.name === "up" ? -1 : 1,
          ),
        );
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
