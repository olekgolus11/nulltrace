import { describe, expect, test } from "bun:test";

process.env.XDG_DATA_HOME = "/private/tmp/nulltrace-test";

const { nucleiCommandService, parseNucleiJsonl } = await import(
  "../nuclei-command.service"
);

describe("nucleiCommandService", () => {
  test("builds a target-centric command with no severity filter by default", () => {
    const toolData = nucleiCommandService.createInitialToolData(
      "https://example.com",
    );

    expect(nucleiCommandService.buildCommand(toolData)).toBe(
      "nuclei -u https://example.com",
    );
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

    expect(nucleiCommandService.buildCommand(medium)).toContain(
      "-severity medium,high,critical",
    );
    expect(nucleiCommandService.buildCommand(high)).toContain(
      "-severity high,critical",
    );
    expect(nucleiCommandService.buildCommand(critical)).toContain(
      "-severity critical",
    );
  });

  test("appends tags, templates path, and extra args when provided", () => {
    const initial = nucleiCommandService.createInitialToolData(
      "https://example.com",
    );
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

  test("forces controlled JSONL output for prepared runs", () => {
    const preparedCommand = nucleiCommandService.prepareCommandForRun({
      command:
        "nuclei -u https://example.com -json -o /tmp/manual.json -jle /tmp/manual.jsonl",
      sessionId: "session-1",
      toolRunId: "run-1",
    });

    expect(preparedCommand).toContain("nuclei -u https://example.com");
    expect(preparedCommand).not.toContain("-json ");
    expect(preparedCommand).not.toContain("/tmp/manual.json");
    expect(preparedCommand).not.toContain("/tmp/manual.jsonl");
    expect(preparedCommand).toContain("-jsonl-export ");
    expect(preparedCommand).toContain(
      "artifacts/sessions/session-1/tool-runs/run-1/nuclei.jsonl",
    );
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
