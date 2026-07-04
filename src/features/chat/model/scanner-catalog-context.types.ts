import type {
  ToolHelpContent,
  ToolName,
} from "../../tool/shared/types/tool-screen.types";

export type ScannerToolImplementationStatus =
  | "implemented"
  | "catalog_only";

export interface ScannerToolContextItem {
  id: ToolName;
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

export interface ScannerCatalogToolModule {
  id: string;
  name: string;
  description: string;
}

export interface ScannerCatalogContextDependencies {
  toolRegistry: Record<string, ScannerCatalogToolModule>;
  helpContent: Record<ToolName, Record<string, ToolHelpContent> | null>;
}
