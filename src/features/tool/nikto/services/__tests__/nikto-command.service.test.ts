import { afterEach, describe, expect, it } from "bun:test";
import { mkdirSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { niktoCommandService } from "../nikto-command.service";

const appDataDirectory = process.env.NULLTRACE_APP_DATA_DIR!;

afterEach(() => {
  rmSync(join(appDataDirectory, "artifacts"), { recursive: true, force: true });
});

describe("niktoCommandService", () => {
  it("builds bounded Standard command from guided fields", () => {
    const data = niktoCommandService.createInitialToolData("https://example.com");
    const configured = {
      ...data,
      form: {
        ...data.form,
        rootPath: "/app",
        vhost: "app.example.com",
        timeoutSeconds: "120",
      },
    };

    expect(niktoCommandService.buildCommand(configured)).toBe(
      "nikto -h 'https://example.com' -root '/app' -vhost 'app.example.com' -maxtime 120s",
    );
  });

  it("rejects prohibited options from manual commands", () => {
    for (const option of ["-Tuning 6", "-mutate 1", "-mutate-options a", "-evasion 1"]) {
      expect(() =>
        niktoCommandService.prepareCommandForRun({
          command: `nikto -h https://example.com ${option}`,
          sessionId: "session-1",
          toolRunId: "run-1",
        }),
      ).toThrow("Nikto Standard rejects");
    }
  });

  it("rejects shell composition and expansion from manual commands", () => {
    for (const command of [
      "nikto -h https://example.com; sleep 9999",
      "nikto -h https://example.com $(printf -- -Tuning)",
      "nikto -h $TARGET",
      "nikto -h https://example.com | sh",
    ]) {
      expect(() =>
        niktoCommandService.prepareCommandForRun({
          command,
          sessionId: "session-1",
          toolRunId: "run-1",
        }),
      ).toThrow("shell expansion and composed commands");
    }
  });

  it("replaces output and runtime controls with controlled values", () => {
    const prepared = niktoCommandService.prepareCommandForRun({
      command: "nikto -h https://example.com -maxtime 9999s -Format csv -output /tmp/x",
      sessionId: "session-1",
      toolRunId: "run-1",
      toolData: {
        ...niktoCommandService.createInitialToolData("https://example.com"),
        form: {
          ...niktoCommandService.createInitialToolData("https://example.com").form,
          timeoutSeconds: "60",
        },
      },
    });

    expect(prepared).toContain("-maxtime 60s -Format json -output");
    expect(prepared).not.toContain("9999s");
    expect(prepared).not.toContain("-Format csv");
    expect(prepared).not.toContain("/tmp/x");
    expect(prepared).toContain("/nikto'");
  });

  it("collects Nikto 2.6 multi-host JSON reports", async () => {
    const reportPath = join(
      appDataDirectory,
      "artifacts/sessions/session-1/tool-runs/run-26/nikto.json",
    );
    mkdirSync(join(reportPath, ".."), { recursive: true });
    writeFileSync(
      reportPath,
      JSON.stringify([
        {
          host: "localhost",
          ip: "127.0.0.1",
          port: "4280",
          vulnerabilities: [
            {
              id: "013587",
              method: "GET",
              url: "/",
              msg: "Suggested security header missing: content-security-policy.",
            },
            {
              id: "006333",
              method: "GET",
              url: "/login.php",
              msg: "Admin login page/section found.",
            },
          ],
        },
      ]),
    );

    const artifacts = await niktoCommandService.collectArtifacts({
      sessionId: "session-1",
      toolRunId: "run-26",
      status: "success",
      exitCode: 0,
    });

    expect(artifacts[0]?.payload).toMatchObject({
      findings: [
        {
          id: "013587",
          url: "http://localhost:4280/",
          message: "Suggested security header missing: content-security-policy.",
        },
        {
          id: "006333",
          url: "http://localhost:4280/login.php",
          message: "Admin login page/section found.",
        },
      ],
      rejectedItemCount: 0,
      parseWarning: null,
    });
  });

  it("parses valid items and preserves malformed item context", async () => {
    const reportPath = join(
      appDataDirectory,
      "artifacts/sessions/session-1/tool-runs/run-1/nikto.json",
    );
    mkdirSync(join(reportPath, ".."), { recursive: true });
    writeFileSync(
      reportPath,
      JSON.stringify({
        vulnerabilities: [
          { id: "001", method: "GET", url: "/admin", msg: "Admin path exposed" },
          { id: "bad", msg: "missing URL" },
        ],
      }),
    );

    const artifacts = await niktoCommandService.collectArtifacts({
      sessionId: "session-1",
      toolRunId: "run-1",
      status: "success",
      exitCode: 0,
    });

    expect(artifacts).toHaveLength(1);
    expect(artifacts[0]?.payload).toMatchObject({
      runContext: { profile: "standard", status: "success", exitCode: 0 },
      findings: [
        {
          id: "001",
          method: "GET",
          url: "/admin",
          message: "Admin path exposed",
          itemIndex: 0,
        },
      ],
      rejectedItemCount: 1,
      parseWarning: "Nikto report skipped 1 malformed item(s).",
    });
  });

  it("keeps malformed report as readable artifact without findings", async () => {
    const reportPath = join(
      appDataDirectory,
      "artifacts/sessions/session-1/tool-runs/run-2/nikto.json",
    );
    mkdirSync(join(reportPath, ".."), { recursive: true });
    writeFileSync(reportPath, '{"vulnerabilities": [');

    const artifacts = await niktoCommandService.collectArtifacts({
      sessionId: "session-1",
      toolRunId: "run-2",
      status: "error",
      exitCode: 2,
    });

    expect(artifacts[0]?.payload).toMatchObject({
      runContext: { profile: "standard", status: "error", exitCode: 2 },
      findings: [],
    });
    expect((artifacts[0]?.payload as Record<string, unknown>).parseWarning).toBeString();
  });

  it("preserves run context when report is absent", async () => {
    const artifacts = await niktoCommandService.collectArtifacts({
      sessionId: "session-1",
      toolRunId: "missing-run",
      status: "error",
      exitCode: 1,
    });

    expect(artifacts[0]?.payload).toEqual({
      source: null,
      runContext: { profile: "standard", status: "error", exitCode: 1 },
      findings: [],
      rejectedItemCount: 0,
      parseWarning: "Nikto did not produce a JSON report.",
    });
  });
});
