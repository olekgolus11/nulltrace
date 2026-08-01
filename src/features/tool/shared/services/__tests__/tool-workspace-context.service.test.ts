import { expect, it } from "bun:test";

process.env.XDG_DATA_HOME = "/private/tmp/nulltrace-workspace-context-test";

const { toolWorkspaceContextService } = await import("../tool-workspace-context.service");

it("redacts Nuclei authorization values from persisted workspace context", () => {
  const snapshot = toolWorkspaceContextService.saveActiveWorkspace({
    sessionId: "redaction-session",
    toolName: "nuclei",
    activePanel: "command",
    commandInput: "nuclei -u https://example.com -H 'Authorization: Bearer secret-token'",
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

  expect(snapshot.commandInput).toBe("nuclei -u https://example.com -H '[redacted]'");
  expect(snapshot.toolData.form.extraArgs).toBe("-H '[redacted]'");
  expect(JSON.stringify(snapshot)).not.toContain("secret-token");
  expect(JSON.stringify(snapshot)).not.toContain("secret-cookie");

  toolWorkspaceContextService.clearActiveWorkspace("redaction-session");
});

it("redacts sqlmap POST bodies from persisted workspace and chat context", () => {
  const snapshot = toolWorkspaceContextService.saveActiveWorkspace({
    sessionId: "sqlmap-redaction-session",
    toolName: "sqlmap",
    activePanel: "command",
    commandInput:
      "sqlmap -u 'https://example.com/login' --method POST --data 'username=alice&password=secret-password' -p username",
    generatedCommand:
      "sqlmap -u 'https://example.com/login' --method POST --data 'username=alice&password=secret-password' -p username",
    commandSource: "generated",
    executionStatus: "idle",
    currentToolRunId: null,
    selectedHistoryRunId: null,
    isHistoricPreview: false,
    toolData: {
      selectedField: 3,
      form: {
        targetUrl: "https://example.com/login",
        method: "POST",
        parameter: "username",
        body: "username=alice&password=secret-password",
      },
    },
  });

  expect(snapshot.commandInput).toContain("--data '[request body redacted]'");
  expect(snapshot.generatedCommand).toContain("--data '[request body redacted]'");
  expect(snapshot.toolData.form.body).toBe("[request body redacted]");
  expect(JSON.stringify(snapshot)).not.toContain("secret-password");
  expect(JSON.stringify(snapshot)).not.toContain("username=alice");

  const persisted = toolWorkspaceContextService.getActiveWorkspace(
    "sqlmap-redaction-session",
  );
  expect(JSON.stringify(persisted)).not.toContain("secret-password");
  expect(JSON.stringify(persisted)).not.toContain("username=alice");

  toolWorkspaceContextService.clearActiveWorkspace("sqlmap-redaction-session");
});

it("redacts Nikto authorization values from persisted workspace context", () => {
  const snapshot = toolWorkspaceContextService.saveActiveWorkspace({
    sessionId: "nikto-redaction-session",
    toolName: "nikto",
    activePanel: "command",
    commandInput:
      "nikto -h https://user:password@example.com -id admin:secret -Tuning x6",
    generatedCommand: "nikto -h https://example.com -Tuning x6",
    commandSource: "manual",
    executionStatus: "idle",
    currentToolRunId: null,
    selectedHistoryRunId: null,
    isHistoricPreview: false,
    toolData: {
      selectedField: 0,
      form: {
        target: "https://user:password@example.com",
        useAuthenticatedContext: true,
      },
    },
  });

  expect(snapshot.commandInput).not.toContain("password");
  expect(snapshot.commandInput).not.toContain("admin:secret");
  expect(snapshot.toolData.form.target).toBe("https://[redacted]@example.com");
  expect(snapshot.toolData.form.useAuthenticatedContext).toBe(false);
  expect(JSON.stringify(snapshot)).not.toContain("password");
  expect(JSON.stringify(snapshot)).not.toContain("admin:secret");

  toolWorkspaceContextService.clearActiveWorkspace("nikto-redaction-session");
});
