import { describe, expect, test } from "bun:test";
import { nucleiCommandService } from "../nuclei-command.service";

describe("nucleiCommandService", () => {
  test("builds a target-centric command with no severity filter by default", () => {
    const toolData = nucleiCommandService.createInitialToolData(
      "https://example.com",
    );

    expect(nucleiCommandService.buildCommand(toolData)).toBe(
      "nuclei -u example.com",
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
      "nuclei -u example.com -tags cve,rce -t /tmp/templates -rate-limit 5",
    );
  });
});
