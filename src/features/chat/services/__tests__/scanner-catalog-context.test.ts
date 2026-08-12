import { describe, expect, it, mock } from "bun:test";
import {
  ScannerCatalogContext,
  listAvailableScannerToolsFromCatalog,
} from "../../../tool/shared/registry/scanner-catalog";
import { ChatContextToolRegistry } from "../chat-context-tool-registry";
import {
  createOpenCodeToolSource,
  ScannerCatalogChatContextToolsService,
} from "../chat-context-tools.service";

type FakeToolName = "nmap" | "nuclei";

function createToolModule(id: FakeToolName) {
  return {
    id,
    name: id === "nmap" ? "Nmap" : "Nuclei",
    description: `${id} scanner`,
    isImplemented: true,
    helpContent: {
      target: {
        title: "Target",
        summary: "Target host.",
        commandEffect: "Adds a target.",
        guidance: "Use a hostname.",
      },
    },
    Workspace: mock(() => null),
    createInitialToolData: mock(() => ({
      form: {},
      selectedField: 0,
    })),
    buildGeneratedCommand: mock(() => `${id} example.test`),
    prepareCommandForRun: mock(({ command }) => command),
    collectArtifacts: mock(async () => []),
  };
}

describe("listAvailableScannerToolsFromCatalog", () => {
  it("returns implemented scanner tools and catalog-only placeholders", () => {
    const nmap = createToolModule("nmap");
    const nuclei = createToolModule("nuclei");

    const context = listAvailableScannerToolsFromCatalog({
      nmap,
      nuclei,
      ffuf: {
        id: "ffuf",
        name: "ffuf",
        description: null,
        isImplemented: false,
        helpContent: null,
      },
      sqlmap: {
        id: "sqlmap",
        name: "sqlmap",
        description: null,
        isImplemented: false,
        helpContent: null,
      },
      nikto: {
        id: "nikto",
        name: "nikto",
        description: null,
        isImplemented: false,
        helpContent: null,
      },
      curl: {
        id: "curl",
        name: "cURL",
        description: null,
        isImplemented: false,
        helpContent: null,
      },
    });

    expect(context).toEqual({
      tools: [
        {
          id: "nmap",
          name: "Nmap",
          description: "nmap scanner",
          implementationStatus: "implemented",
          isImplemented: true,
          hasHelp: true,
        },
        {
          id: "nuclei",
          name: "Nuclei",
          description: "nuclei scanner",
          implementationStatus: "implemented",
          isImplemented: true,
          hasHelp: true,
        },
        {
          id: "ffuf",
          name: "ffuf",
          description: null,
          implementationStatus: "catalog_only",
          isImplemented: false,
          hasHelp: false,
        },
        {
          id: "sqlmap",
          name: "sqlmap",
          description: null,
          implementationStatus: "catalog_only",
          isImplemented: false,
          hasHelp: false,
        },
        {
          id: "nikto",
          name: "nikto",
          description: null,
          implementationStatus: "catalog_only",
          isImplemented: false,
          hasHelp: false,
        },
        {
          id: "curl",
          name: "cURL",
          description: null,
          implementationStatus: "catalog_only",
          isImplemented: false,
          hasHelp: false,
        },
      ],
      counts: {
        total: 6,
        implemented: 2,
        catalogOnly: 4,
      },
    });
  });

  it("does not generate commands, execute commands, or mutate tool state", () => {
    const nmap = createToolModule("nmap");

    listAvailableScannerToolsFromCatalog({
      nmap,
      nuclei: {
        id: "nuclei",
        name: "nuclei",
        description: null,
        isImplemented: false,
        helpContent: null,
      },
      ffuf: {
        id: "ffuf",
        name: "ffuf",
        description: null,
        isImplemented: false,
        helpContent: null,
      },
      sqlmap: {
        id: "sqlmap",
        name: "sqlmap",
        description: null,
        isImplemented: false,
        helpContent: null,
      },
      nikto: {
        id: "nikto",
        name: "nikto",
        description: null,
        isImplemented: false,
        helpContent: null,
      },
      curl: {
        id: "curl",
        name: "cURL",
        description: null,
        isImplemented: false,
        helpContent: null,
      },
    });

    expect(nmap.Workspace).not.toHaveBeenCalled();
    expect(nmap.createInitialToolData).not.toHaveBeenCalled();
    expect(nmap.buildGeneratedCommand).not.toHaveBeenCalled();
    expect(nmap.prepareCommandForRun).not.toHaveBeenCalled();
    expect(nmap.collectArtifacts).not.toHaveBeenCalled();
  });

  it("executes through the shared registry with no model-supplied args", async () => {
    const nmap = createToolModule("nmap");
    const service = new ScannerCatalogChatContextToolsService({
      nmap,
      nuclei: {
        id: "nuclei",
        name: "nuclei",
        description: null,
        isImplemented: false,
        helpContent: null,
      },
      ffuf: {
        id: "ffuf",
        name: "ffuf",
        description: null,
        isImplemented: false,
        helpContent: null,
      },
      sqlmap: {
        id: "sqlmap",
        name: "sqlmap",
        description: null,
        isImplemented: false,
        helpContent: null,
      },
      nikto: {
        id: "nikto",
        name: "nikto",
        description: null,
        isImplemented: false,
        helpContent: null,
      },
      curl: {
        id: "curl",
        name: "cURL",
        description: null,
        isImplemented: false,
        helpContent: null,
      },
    });
    const registry = new ChatContextToolRegistry(service.createToolDefinitions());

    const result = (await registry.execute("list_available_scanner_tools", "opencode-1", {
      sessionId: "ignored",
    })) as ScannerCatalogContext;

    expect(registry.listDefinitions()).toMatchObject([
      {
        name: "list_available_scanner_tools",
        args: {},
      },
    ]);
    expect(result).toMatchObject({
      counts: {
        total: 6,
        implemented: 1,
        catalogOnly: 5,
      },
    });
    expect(result.tools.find((tool) => tool.id === "nmap")).toMatchObject({
      id: "nmap",
      implementationStatus: "implemented",
    });
    expect(result.tools.find((tool) => tool.id === "nuclei")).toMatchObject({
      id: "nuclei",
      implementationStatus: "catalog_only",
    });
    expect(nmap.buildGeneratedCommand).not.toHaveBeenCalled();
  });

  it("generates an OpenCode wrapper for list_available_scanner_tools", () => {
    const source = createOpenCodeToolSource("list_available_scanner_tools");

    expect(source).toContain("context.sessionID");
    expect(source).toContain('"list_available_scanner_tools"');
    expect(source).toContain("args: {}");
    expect(source).not.toContain("findingId");
    expect(source).not.toContain("sessionId");
  });
});
