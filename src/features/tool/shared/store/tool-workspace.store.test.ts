import { beforeEach, describe, expect, test } from "bun:test";
import { nmapCommandService } from "../../nmap/services/nmap-command.service";
import { NmapToolData } from "../../nmap/types/nmap.types";
import { useToolWorkspaceStore } from "./tool-workspace.store";

function resetWorkspaceStore() {
  useToolWorkspaceStore.setState(useToolWorkspaceStore.getInitialState());
}

describe("tool workspace command state", () => {
  beforeEach(() => {
    resetWorkspaceStore();
  });

  test("initializes nmap workspace with generated command mode", () => {
    const store = useToolWorkspaceStore.getState();

    store.initializeWorkspace("nmap", "https://scanme.nmap.org");

    const nextState = useToolWorkspaceStore.getState();

    expect(nextState.commandSource).toBe("generated");
    expect(nextState.commandInput).toBe("nmap -sV -T3 scanme.nmap.org");
    expect(nextState.generatedCommand).toBe(nextState.commandInput);
  });

  test("manual edits switch command mode immediately", () => {
    const store = useToolWorkspaceStore.getState();

    store.initializeWorkspace("nmap", "https://scanme.nmap.org");
    useToolWorkspaceStore.getState().setManualCommandInput("nmap -Pn scanme.nmap.org");

    const nextState = useToolWorkspaceStore.getState();

    expect(nextState.commandSource).toBe("manual");
    expect(nextState.commandInput).toBe("nmap -Pn scanme.nmap.org");
    expect(nextState.generatedCommand).toBe("nmap -sV -T3 scanme.nmap.org");
  });

  test("generated command refreshes do not overwrite manual command input", () => {
    const store = useToolWorkspaceStore.getState();

    store.initializeWorkspace("nmap", "https://scanme.nmap.org");
    useToolWorkspaceStore.getState().setManualCommandInput("nmap -Pn scanme.nmap.org");
    useToolWorkspaceStore.getState().updateToolData((current) =>
      nmapCommandService.setField(
        current as NmapToolData,
        "aggressive",
        true,
      ),
    );
    useToolWorkspaceStore.getState().syncGeneratedCommand();

    const nextState = useToolWorkspaceStore.getState();

    expect(nextState.commandSource).toBe("manual");
    expect(nextState.commandInput).toBe("nmap -Pn scanme.nmap.org");
    expect(nextState.generatedCommand).toBe("nmap -A -T3 scanme.nmap.org");
  });

  test("reset restores generated command mode and command text", () => {
    const store = useToolWorkspaceStore.getState();

    store.initializeWorkspace("nmap", "https://scanme.nmap.org");
    useToolWorkspaceStore.getState().setManualCommandInput("nmap -Pn scanme.nmap.org");
    useToolWorkspaceStore.getState().resetCommandToGenerated();

    const nextState = useToolWorkspaceStore.getState();

    expect(nextState.commandSource).toBe("generated");
    expect(nextState.commandInput).toBe("nmap -sV -T3 scanme.nmap.org");
    expect(nextState.generatedCommand).toBe("nmap -sV -T3 scanme.nmap.org");
  });

  test("pane changes do not alter command mode after reset", () => {
    const store = useToolWorkspaceStore.getState();

    store.initializeWorkspace("nmap", "https://scanme.nmap.org");
    useToolWorkspaceStore.getState().setManualCommandInput("nmap -Pn scanme.nmap.org");
    useToolWorkspaceStore.getState().resetCommandToGenerated();
    useToolWorkspaceStore.getState().cyclePanel();

    const nextState = useToolWorkspaceStore.getState();

    expect(nextState.activePanel).toBe("command");
    expect(nextState.commandSource).toBe("generated");
    expect(nextState.commandInput).toBe(nextState.generatedCommand);
  });
});
