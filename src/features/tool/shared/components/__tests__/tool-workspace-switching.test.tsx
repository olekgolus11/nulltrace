import { afterEach, expect, test } from "bun:test";
import { testRender } from "@opentui/react/test-utils";
import { act } from "react";
import { FfufWorkspace } from "../../../ffuf/components/FfufWorkspace";
import { NmapToolData } from "../../../nmap/types/nmap.types";
import { NiktoToolData } from "../../../nikto/types/nikto.types";
import { NucleiWorkspace } from "../../../nuclei/components/NucleiWorkspace";
import { nmapCommandService } from "../../../nmap/services/nmap-command.service";
import { niktoCommandService } from "../../../nikto/services/nikto-command.service";
import { useToolWorkspaceStore } from "../../store/tool-workspace.store";

let testSetup: Awaited<ReturnType<typeof testRender>> | null = null;

afterEach(() => {
  act(() => {
    testSetup?.renderer.destroy();
  });
  testSetup = null;
});

const staleWorkspaceStates = [
  {
    sourceTool: "nmap",
    toolData: nmapCommandService.createInitialToolData("https://example.com"),
  },
  {
    sourceTool: "nikto",
    toolData: niktoCommandService.createInitialToolData("https://example.com"),
  },
] as const satisfies ReadonlyArray<{
  sourceTool: "nmap" | "nikto";
  toolData: NmapToolData | NiktoToolData;
}>;

for (const { sourceTool, toolData } of staleWorkspaceStates) {
  test(`renders FFUF while ${sourceTool} workspace data is still active`, async () => {
    useToolWorkspaceStore.setState({
      toolName: sourceTool,
      toolData,
    });

    testSetup = await testRender(<FfufWorkspace />, {
      width: 120,
      height: 40,
    });
    await testSetup.renderOnce();

    expect(testSetup.captureCharFrame()).toContain("FFUF Content Discovery");
  });

  test(`renders Nuclei while ${sourceTool} workspace data is still active`, async () => {
    useToolWorkspaceStore.setState({
      toolName: sourceTool,
      toolData,
    });

    testSetup = await testRender(<NucleiWorkspace />, {
      width: 120,
      height: 40,
    });
    await testSetup.renderOnce();

    expect(testSetup.captureCharFrame()).toContain("Nuclei Controls");
  });
}
