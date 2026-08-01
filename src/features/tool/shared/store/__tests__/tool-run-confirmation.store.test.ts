import { afterEach, describe, expect, it } from "bun:test";
import { niktoCommandService } from "../../../nikto/services/nikto-command.service";
import { useToolWorkspaceStore } from "../tool-workspace.store";

afterEach(() => {
  useToolWorkspaceStore.setState({
    pendingRunConfirmation: null,
    executionStatus: "idle",
  });
});

describe("tool run confirmation", () => {
  it("gates disruptive Nikto execution and cancellation preserves workspace state", async () => {
    const base = niktoCommandService.setProfile(
      niktoCommandService.createInitialToolData("https://example.com"),
      "custom",
    );
    const custom = {
      ...base,
      form: {
        ...base.form,
        tuning: ["6" as const],
      },
    };
    const command = niktoCommandService.buildCommand(custom);
    useToolWorkspaceStore.setState({
      toolName: "nikto",
      sessionId: "session-1",
      targetUrl: "https://example.com",
      toolData: custom,
      commandInput: command,
      generatedCommand: command,
      commandSource: "generated",
      outputLines: ["unchanged"],
      executionStatus: "idle",
      lastExitCode: null,
      isHistoricPreview: false,
    });

    await useToolWorkspaceStore.getState().runCommand();

    expect(useToolWorkspaceStore.getState().pendingRunConfirmation).toMatchObject({
      command,
      confirmationKey: "y",
    });
    expect(useToolWorkspaceStore.getState().executionStatus).toBe("idle");
    expect(useToolWorkspaceStore.getState().outputLines).toEqual(["unchanged"]);

    useToolWorkspaceStore.getState().cancelPendingRun();

    expect(useToolWorkspaceStore.getState().pendingRunConfirmation).toBeNull();
    expect(useToolWorkspaceStore.getState().commandInput).toBe(command);
    expect(useToolWorkspaceStore.getState().toolData).toEqual(custom);
    expect(useToolWorkspaceStore.getState().outputLines).toEqual(["unchanged"]);
    expect(useToolWorkspaceStore.getState().executionStatus).toBe("idle");
  });

  it("consumes Nikto authentication selection when a run starts", async () => {
    let data = niktoCommandService.createInitialToolData("https://example.com");
    data = niktoCommandService.setAuthenticationAvailability(data, "https://example.com");
    data = niktoCommandService.toggleAuthenticatedContext(data);
    const command = niktoCommandService.buildCommand(data);
    useToolWorkspaceStore.setState({
      toolName: "nikto",
      sessionId: null,
      targetUrl: "https://example.com",
      toolData: data,
      commandInput: command,
      generatedCommand: command,
      commandSource: "generated",
      outputLines: [],
      executionStatus: "idle",
      lastExitCode: null,
      isHistoricPreview: false,
    });

    await useToolWorkspaceStore.getState().runCommand();

    const current = useToolWorkspaceStore.getState().toolData as typeof data;
    expect(current.form.useAuthenticatedContext).toBe(false);
    expect(current.authentication.strategy).toBe("none");
  });
});
