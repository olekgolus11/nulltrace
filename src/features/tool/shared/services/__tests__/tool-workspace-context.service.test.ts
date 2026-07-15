import { expect, it } from "bun:test";

process.env.XDG_DATA_HOME = "/private/tmp/nulltrace-workspace-context-test";

const { toolWorkspaceContextService } = await import(
  "../tool-workspace-context.service"
);

it("redacts Nuclei authorization values from persisted workspace context", () => {
  const snapshot = toolWorkspaceContextService.saveActiveWorkspace({
    sessionId: "redaction-session",
    toolName: "nuclei",
    activePanel: "command",
    commandInput:
      "nuclei -u https://example.com -H 'Authorization: Bearer secret-token'",
    generatedCommand: "nuclei -u https://example.com",
    commandSource: "manual",
    executionStatus: "idle",
    currentToolRunId: null,
    selectedHistoryRunId: null,
    isHistoricPreview: false,
    toolData: {
      selectedField: 0,
      form: {
        target: "https://example.com",
        extraArgs: "-H 'Cookie: session=secret-cookie'",
      },
    },
  });

  expect(snapshot.commandInput).toBe(
    "nuclei -u https://example.com -H '[redacted]'",
  );
  expect(snapshot.toolData.form.extraArgs).toBe("-H '[redacted]'");
  expect(JSON.stringify(snapshot)).not.toContain("secret-token");
  expect(JSON.stringify(snapshot)).not.toContain("secret-cookie");

  toolWorkspaceContextService.clearActiveWorkspace("redaction-session");
});
