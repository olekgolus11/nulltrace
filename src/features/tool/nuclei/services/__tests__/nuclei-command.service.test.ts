import { describe, expect, test } from "bun:test";

process.env.XDG_DATA_HOME = "/private/tmp/nulltrace-test";

const { parseNucleiJsonl } = await import("../nuclei-command.helpers");
const { nucleiCommandService } = await import("../nuclei-command.service");

describe("nucleiCommandService", () => {
  test("builds a target-centric command with no severity filter by default", () => {
    const toolData = nucleiCommandService.createInitialToolData("https://example.com");

    expect(nucleiCommandService.buildCommand(toolData)).toBe("nuclei -u https://example.com");
  });

  test("maps severity presets to nuclei CLI severity values", () => {
    const medium = nucleiCommandService.setField(
      nucleiCommandService.createInitialToolData("https://example.com"),
      "severityPreset",
      "medium+",
    );
    const high = nucleiCommandService.setField(
      nucleiCommandService.createInitialToolData("https://example.com"),
      "severityPreset",
      "high+",
    );
    const critical = nucleiCommandService.setField(
      nucleiCommandService.createInitialToolData("https://example.com"),
      "severityPreset",
      "critical",
    );

    expect(nucleiCommandService.buildCommand(medium)).toContain("-severity medium,high,critical");
    expect(nucleiCommandService.buildCommand(high)).toContain("-severity high,critical");
    expect(nucleiCommandService.buildCommand(critical)).toContain("-severity critical");
  });

  test("appends tags, templates path, and extra args when provided", () => {
    const initial = nucleiCommandService.createInitialToolData("https://example.com");
    const withTags = nucleiCommandService.setField(initial, "tags", "cve,rce");
    const withTemplates = nucleiCommandService.setField(
      withTags,
      "templatesPath",
      "/tmp/templates",
    );
    const withExtraArgs = nucleiCommandService.setField(
      withTemplates,
      "extraArgs",
      "-rate-limit 5",
    );

    expect(nucleiCommandService.buildCommand(withExtraArgs)).toBe(
      "nuclei -u https://example.com -tags cve,rce -t /tmp/templates -rate-limit 5",
    );
  });

  test("hides and disables session auth when the editable target changes origin", () => {
    let toolData = nucleiCommandService.createInitialToolData("https://example.com");
    toolData = nucleiCommandService.setAuthenticationAvailability(toolData, "https://example.com");
    toolData = nucleiCommandService.toggleAuthenticatedContext(toolData);

    expect(toolData.authentication.isAvailable).toBe(true);
    expect(toolData.form.useAuthenticatedContext).toBe(true);

    toolData = nucleiCommandService.setField(toolData, "target", "https://api.example.com");

    expect(toolData.authentication).toMatchObject({
      isAvailable: false,
      origin: "https://example.com",
      strategy: "none",
    });
    expect(toolData.form.useAuthenticatedContext).toBe(false);
  });

  test("forces controlled JSONL output for prepared runs", async () => {
    const preparedCommand = await nucleiCommandService.prepareCommandForRun({
      command: "nuclei -u https://example.com -json -o /tmp/manual.json -jle /tmp/manual.jsonl",
      sessionId: "session-1",
      toolRunId: "run-1",
    });

    expect(preparedCommand).toContain("nuclei -u https://example.com");
    expect(preparedCommand).not.toContain("-json ");
    expect(preparedCommand).not.toContain("/tmp/manual.json");
    expect(preparedCommand).not.toContain("/tmp/manual.jsonl");
    expect(preparedCommand).toContain(" -nc ");
    expect(preparedCommand).toContain("-jsonl-export ");
    expect(preparedCommand).toContain("artifacts/sessions/session-1/tool-runs/run-1/nuclei.jsonl");
  });

  test("keeps an existing no-color flag when preparing a run", async () => {
    const preparedCommand = await nucleiCommandService.prepareCommandForRun({
      command: "nuclei -u https://example.com -nc",
      sessionId: "session-1",
      toolRunId: "run-no-color",
    });

    if (typeof preparedCommand !== "string") {
      throw new Error("Expected unauthenticated command preparation.");
    }

    expect(preparedCommand.match(/ -nc/g)).toHaveLength(1);
  });

  test("strips quoted output flag paths without leaving dangling arguments", async () => {
    const preparedCommand = await nucleiCommandService.prepareCommandForRun({
      command:
        "nuclei -u https://example.com -jsonl-export '/tmp/my output.jsonl' -o \"/tmp/text output.txt\"",
      sessionId: "session-1",
      toolRunId: "run-quoted",
    });

    expect(preparedCommand).toContain("nuclei -u https://example.com");
    expect(preparedCommand).not.toContain("my output.jsonl");
    expect(preparedCommand).not.toContain("output.txt");
    expect(preparedCommand).not.toContain("output.jsonl'");
    expect(preparedCommand).toContain("-jsonl-export ");
    expect(preparedCommand).toContain(
      "artifacts/sessions/session-1/tool-runs/run-quoted/nuclei.jsonl",
    );
  });

  test("rejects raw request or response output flags for authenticated runs", async () => {
    const toolData = nucleiCommandService.createInitialToolData("https://example.com");
    toolData.form.useAuthenticatedContext = true;

    await expect(
      nucleiCommandService.prepareCommandForRun({
        command: "nuclei -u https://example.com -debug-req -store-resp-dir /tmp/raw",
        sessionId: "session-1",
        toolRunId: "run-auth",
        toolData,
      }),
    ).rejects.toThrow("Authenticated Nuclei runs cannot use options");
    await expect(
      nucleiCommandService.prepareCommandForRun({
        command: "nuclei -u https://example.com -follow-host-redirects",
        sessionId: "session-1",
        toolRunId: "run-auth-redirect",
        toolData,
      }),
    ).rejects.toThrow("Authenticated Nuclei runs cannot use options");
    for (const command of [
      "nuclei -u https://example.com --debug",
      "nuclei -u https://example.com '-include-rr'",
      'nuclei -u https://example.com -de""bug',
      "nuclei -u https://example.com --omit-raw=false",
      "nuclei -u https://example.com -u http://example.com",
      "nuclei -list targets.txt",
      "F=-debug; nuclei $F -u https://example.com",
      "nuclei $(printf -- -debug) -u https://example.com",
      "nuclei -u https://example.com -*",
      "/tmp/helper -u https://example.com",
      "nuclei -u https://example.com -t /tmp/custom-template.yaml",
      "nuclei -u https://example.com -it /tmp/custom-template.yaml",
      "nuclei -u https://example.com -include-templates /tmp/custom-template.yaml",
    ]) {
      await expect(
        nucleiCommandService.prepareCommandForRun({
          command,
          sessionId: "session-1",
          toolRunId: "run-auth-bypass",
          toolData,
        }),
      ).rejects.toThrow("Authenticated Nuclei runs");
    }
  });

  test("redacts manually supplied authorization values from persisted commands", () => {
    expect(
      nucleiCommandService.redactCommandForPersistence(
        "nuclei -u https://example.com -H 'Authorization: Bearer secret-token' -H 'Cookie: session=secret-cookie'",
      ),
    ).toBe("nuclei -u https://example.com -H '[redacted]' -H '[redacted]'");
    expect(
      nucleiCommandService.redactCommandForPersistence(
        "nuclei -u=https://example.com -header='Authorization: Bearer inline-secret'",
      ),
    ).toBe("nuclei -u=https://example.com -header '[redacted]'");
    expect(
      nucleiCommandService.redactCommandForPersistence(
        "nuclei -u https://example.com -H Authorization: Bearer unquoted-secret -stats",
      ),
    ).toBe("nuclei -u https://example.com -H '[redacted]' -stats");
  });

  test("parses valid JSONL findings with normalized convenience fields and raw preservation", () => {
    const content = [
      JSON.stringify({
        "template-id": "cves/2024/test",
        "matched-at": "https://example.com/login",
        type: "http",
        info: {
          name: "Example exposure",
          severity: "high",
          tags: "cve,exposure",
          description: "A useful description",
          reference: ["https://example.com/advisory"],
        },
      }),
    ].join("\n");

    const result = parseNucleiJsonl(content);

    expect(result.parseErrorCount).toBe(0);
    expect(result.findings).toHaveLength(1);
    expect(result.findings[0]).toMatchObject({
      templateId: "cves/2024/test",
      name: "Example exposure",
      severity: "high",
      matchedAt: "https://example.com/login",
      type: "http",
      tags: ["cve", "exposure"],
      description: "A useful description",
      references: ["https://example.com/advisory"],
    });
    expect(result.findings[0]?.raw).toMatchObject({
      "template-id": "cves/2024/test",
    });
  });

  test("keeps valid JSONL lines and counts malformed lines", () => {
    const content = [
      "{not-json",
      JSON.stringify({
        "template-id": "ssl/self-signed",
        host: "https://example.com",
        info: {
          severity: "low",
        },
      }),
      JSON.stringify(["unexpected"]),
    ].join("\n");

    const result = parseNucleiJsonl(content);

    expect(result.parseErrorCount).toBe(2);
    expect(result.findings).toHaveLength(1);
    expect(result.findings[0]).toMatchObject({
      templateId: "ssl/self-signed",
      name: "ssl/self-signed",
      severity: "low",
      matchedAt: "https://example.com",
    });
  });
});
