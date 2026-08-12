import { nmapHelpContent } from "../../nmap/data/nmap-help";
import { nucleiHelpContent } from "../../nuclei/data/nuclei-help";

export type ScannerToolId = "nmap" | "nuclei" | "ffuf" | "sqlmap" | "nikto" | "curl";

export type ScannerToolImplementationStatus = "implemented" | "catalog_only";

export interface ScannerCatalogTool {
  id: ScannerToolId;
  name: string;
  description: string | null;
  isImplemented: boolean;
  helpContent: Record<string, ScannerToolHelpContent> | null;
}

export interface ScannerToolHelpContent {
  title: string;
  summary: string;
  commandEffect: string;
  guidance: string;
}

export interface ScannerToolContextItem {
  id: ScannerToolId;
  name: string;
  description: string | null;
  implementationStatus: ScannerToolImplementationStatus;
  isImplemented: boolean;
  hasHelp: boolean;
}

export interface ScannerCatalogContext {
  tools: ScannerToolContextItem[];
  counts: {
    total: number;
    implemented: number;
    catalogOnly: number;
  };
}

export const scannerCatalog: Record<ScannerToolId, ScannerCatalogTool> = {
  nmap: {
    id: "nmap",
    name: "Nmap",
    description: "Network mapper with guided scan profiles and manual control.",
    isImplemented: true,
    helpContent: nmapHelpContent,
  },
  nuclei: {
    id: "nuclei",
    name: "Nuclei",
    description: "Template-based vulnerability scanner with editable runs.",
    isImplemented: true,
    helpContent: nucleiHelpContent,
  },
  ffuf: {
    id: "ffuf",
    name: "ffuf",
    description: "Content and Parameter Discovery with exact-origin run boundaries.",
    isImplemented: true,
    helpContent: null,
  },
  sqlmap: {
    id: "sqlmap",
    name: "sqlmap",
    description: "Targeted SQL injection verification for one endpoint and parameter.",
    isImplemented: true,
    helpContent: null,
  },
  nikto: {
    id: "nikto",
    name: "Nikto",
    description:
      "Web-server scanner with Standard and constrained Custom tuning profiles.",
    isImplemented: true,
    helpContent: null,
  },
  curl: {
    id: "curl",
    name: "cURL",
    description: "Bounded exact-origin HTTP requests with optional session authentication.",
    isImplemented: true,
    helpContent: null,
  },
};

export function listAvailableScannerToolsFromCatalog(
  catalog: Record<ScannerToolId, ScannerCatalogTool> = scannerCatalog,
): ScannerCatalogContext {
  const tools = Object.values(catalog).map((tool) => {
    const implementationStatus: ScannerToolImplementationStatus = tool.isImplemented
      ? "implemented"
      : "catalog_only";

    return {
      id: tool.id,
      name: tool.name,
      description: tool.description,
      implementationStatus,
      isImplemented: tool.isImplemented,
      hasHelp: Boolean(tool.helpContent),
    };
  });

  const implemented = tools.filter((tool) => tool.isImplemented).length;

  return {
    tools,
    counts: {
      total: tools.length,
      implemented,
      catalogOnly: tools.length - implemented,
    },
  };
}
