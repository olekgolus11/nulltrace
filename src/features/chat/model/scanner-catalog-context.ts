import type { ToolName } from "../../tool/shared/types/tool-screen.types";
import type {
  ScannerCatalogContext,
  ScannerCatalogContextDependencies,
  ScannerToolImplementationStatus,
} from "./scanner-catalog-context.types";

export function listAvailableScannerToolsFromCatalog({
  toolRegistry,
  helpContent,
}: ScannerCatalogContextDependencies): ScannerCatalogContext {
  const tools = (Object.keys(helpContent) as ToolName[]).map((toolId) => {
    const toolModule = toolRegistry[toolId];
    const isImplemented = Boolean(toolModule);
    const hasHelp = Boolean(helpContent[toolId]);
    const implementationStatus: ScannerToolImplementationStatus = isImplemented
      ? "implemented"
      : "catalog_only";

    return {
      id: toolId,
      name: toolModule?.name ?? toolId,
      description: toolModule?.description ?? null,
      implementationStatus,
      isImplemented,
      hasHelp,
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
