import { afterEach, describe, expect, it } from "bun:test";
import { mkdirSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { niktoCommandService } from "../nikto-command.service";

const appDataDirectory = process.env.NULLTRACE_APP_DATA_DIR!;

afterEach(() => {
  rmSync(join(appDataDirectory, "artifacts"), { recursive: true, force: true });
});

describe("niktoCommandService", () => {
  it("switches between Standard and Custom without losing Custom selections", () => {
    const standard = niktoCommandService.createInitialToolData("https://example.com");
    const custom = niktoCommandService.setProfile(standard, "custom");
    const tuned = {
      ...custom,
      form: {
        ...custom.form,
        tuning: ["6" as const],
      },
    };
    const returnedToStandard = niktoCommandService.setProfile(tuned, "standard");

    expect(returnedToStandard.form.profile).toBe("standard");
    expect(returnedToStandard.form.tuning).toEqual(["6"]);
    expect(niktoCommandService.buildCommand(returnedToStandard)).toContain(
      "-Tuning 'x6'",
    );
    expect(
      niktoCommandService.buildCommand(
        niktoCommandService.setProfile(returnedToStandard, "custom"),
      ),
    ).toContain("-Tuning '6'");
  });

  it("builds constrained Custom tuning and request controls", () => {
    const data = niktoCommandService.createInitialToolData("https://example.com");
    const custom = niktoCommandService.setProfile(data, "custom");
    const configured = {
      ...niktoCommandService.toggleTuning(
        niktoCommandService.toggleTuning(custom, "2"),
        "b",
      ),
      form: {
        ...custom.form,
        tuning: ["2" as const, "b" as const],
        requestTimeoutSeconds: "15",
        pauseSeconds: "2",
      },
    };

    expect(niktoCommandService.buildCommand(configured)).toBe(
      "nikto -h 'https://example.com' -Tuning '2b' -timeout 15 -Pause 2 -maxtime 300s",
    );
  });

  it("classifies denial-of-service tuning in generated and manually edited commands", () => {
    const custom = niktoCommandService.setProfile(
      niktoCommandService.createInitialToolData("https://example.com"),
      "custom",
    );

    expect(
      niktoCommandService.getRunConfirmation(
        "nikto -h https://example.com -Tuning 26",
        custom,
      ),
    ).toMatchObject({
      title: "Confirm disruptive Nikto checks",
      confirmationKey: "y",
    });
    expect(
      niktoCommandService.getRunConfirmation(
        "nikto -h https://example.com '-T' '6'",
        custom,
      ),
    ).not.toBeNull();
    expect(
      niktoCommandService.getRunConfirmation(
        "nikto -h https://example.com -Tun''ing=6",
        custom,
      ),
    ).not.toBeNull();
    expect(
      niktoCommandService.getRunConfirmation(
        "nikto -h https://example.com --Tun 6",
        custom,
      ),
    ).not.toBeNull();
    expect(
      niktoCommandService.getRunConfirmation(
        "nikto -h https://example.com +Tuning 6",
        custom,
      ),
    ).not.toBeNull();
    expect(
      niktoCommandService.getRunConfirmation(
        "nikto -h https://example.com -Tuning=2b",
        custom,
      ),
    ).toBeNull();
    expect(() =>
      niktoCommandService.getRunConfirmation(
        "nikto -h https://example.com -Tuning",
        custom,
      ),
    ).not.toThrow();
  });

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
      "nikto -h 'https://example.com' -Tuning 'x6' -root '/app' -vhost 'app.example.com' -maxtime 120s",
    );
  });

  it("requires explicit denial-of-service exclusion in manually edited Standard commands", () => {
    const standard = niktoCommandService.createInitialToolData("https://example.com");

    expect(() =>
      niktoCommandService.prepareCommandForRun({
        command: "nikto -h https://example.com",
        sessionId: "session-1",
        toolRunId: "run-standard-bypass",
        toolData: standard,
      }),
    ).toThrow("Nikto Standard requires -Tuning x6");
    expect(() =>
      niktoCommandService.prepareCommandForRun({
        command: "nikto -h https://example.com --Tun x6",
        sessionId: null,
        toolRunId: null,
        toolData: standard,
      }),
    ).not.toThrow();
    expect(() =>
      niktoCommandService.prepareCommandForRun({
        command:
          "nikto -h https://example.com -Tuning x -Tuning 6",
        sessionId: "session-1",
        toolRunId: "run-repeated-tuning-bypass",
        toolData: standard,
      }),
    ).toThrow("Nikto accepts exactly one tuning option");
  });

  it("rejects prohibited options from manual commands", () => {
    for (const option of [
      "-Tuning 6",
      "'-Tuning' 6",
      "-Tun''ing 6",
      "-mutate 1",
      "-mutate-options a",
      "-evasion 1",
      "--eva 1",
      "+evasion 1",
    ]) {
      expect(() =>
        niktoCommandService.prepareCommandForRun({
          command: `nikto -h https://example.com ${option}`,
          sessionId: "session-1",
          toolRunId: "run-1",
        }),
      ).toThrow("Nikto Standard");
    }
  });

  it("rejects unsupported Custom tuning, reverse tuning, mutation, and evasion", () => {
    const custom = niktoCommandService.setProfile(
      niktoCommandService.createInitialToolData("https://example.com"),
      "custom",
    );

    for (const option of [
      "-Tuning 8",
      "-Tuning x2",
      "-Tuning 2x6",
      "-mutate 1",
      "-mutate-options a",
      "-evasion 1",
    ]) {
      expect(() =>
        niktoCommandService.prepareCommandForRun({
          command: `nikto -h https://example.com ${option}`,
          sessionId: "session-1",
          toolRunId: "run-custom",
          toolData: custom,
        }),
      ).toThrow();
    }
  });

  it("rejects shell composition and expansion from manual commands", () => {
    for (const command of [
      "nikto -h https://example.com; sleep 9999",
      "nikto -h https://example.com $(printf -- -Tuning)",
      "nikto -h $TARGET",
      "nikto -h https://example.com | sh",
      "nikto -h https://example.com # skip enforced controls",
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

  it("accepts apostrophes escaped by guided form quoting", () => {
    const data = niktoCommandService.createInitialToolData(
      "https://example.com/O'Reilly",
    );
    const command = niktoCommandService.buildCommand(data);

    expect(() =>
      niktoCommandService.prepareCommandForRun({
        command,
        sessionId: "session-1",
        toolRunId: "run-apostrophe",
        toolData: data,
      }),
    ).not.toThrow();
  });

  it("replaces output and runtime controls with controlled values", () => {
    const prepared = niktoCommandService.prepareCommandForRun({
      command:
        "nikto -h https://example.com -Tuning x6 -maxtime 9999s -Format csv -output /tmp/x",
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

  it("bounds manually edited Custom request controls", () => {
    const base = niktoCommandService.setProfile(
      niktoCommandService.createInitialToolData("https://example.com"),
      "custom",
    );
    const custom = {
      ...base,
      form: {
        ...base.form,
        requestTimeoutSeconds: "15",
        pauseSeconds: "2",
      },
    };
    const prepared = niktoCommandService.prepareCommandForRun({
      command:
        "nikto -h https://example.com -Tuning 2b -timeout 999 -Pause 999",
      sessionId: "session-1",
      toolRunId: "run-custom-controls",
      toolData: custom,
    });

    expect(prepared).toContain("-Tuning 2b -timeout 15 -Pause 2 -maxtime 300s");
    expect(prepared).not.toContain("-timeout 999");
    expect(prepared).not.toContain("-Pause 999");
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
      toolData: niktoCommandService.createInitialToolData(
        "https://localhost:4280",
      ),
    });

    expect(artifacts[0]?.payload).toMatchObject({
      findings: [
        {
          id: "013587",
          url: "https://localhost:4280/",
          message: "Suggested security header missing: content-security-policy.",
        },
        {
          id: "006333",
          url: "https://localhost:4280/login.php",
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

  it("uses the same report artifact contract for Custom scans", async () => {
    const custom = niktoCommandService.setProfile(
      niktoCommandService.createInitialToolData("https://example.com"),
      "custom",
    );
    const artifacts = await niktoCommandService.collectArtifacts({
      sessionId: "session-1",
      toolRunId: "missing-custom-run",
      status: "error",
      exitCode: 1,
      toolData: custom,
    });

    expect(artifacts[0]).toMatchObject({
      artifactType: "nikto_report",
      label: "Nikto Custom report",
      payload: {
        runContext: {
          profile: "custom",
          status: "error",
          exitCode: 1,
        },
        findings: [],
      },
    });
  });
});
