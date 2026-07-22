import { describe, expect, it } from "bun:test";
import { createFindingSourceContextFields } from "../finding-source-context";

describe("createFindingSourceContextFields", () => {
  it("formats nmap open port payloads", () => {
    const fields = createFindingSourceContextFields({
      sourceTool: "nmap",
      kind: "nmap.open_port",
      payload: {
        artifactItemPath: "$.hosts[0].ports[0]",
        host: "example.com",
        protocol: "tcp",
        port: "443",
        state: "open",
        reason: "syn-ack",
      },
    });

    expect(fields).toEqual([
      { label: "Artifact Path", value: "$.hosts[0].ports[0]" },
      { label: "Host", value: "example.com" },
      { label: "Protocol", value: "tcp" },
      { label: "Port", value: "443" },
      { label: "State", value: "open" },
      { label: "Reason", value: "syn-ack" },
    ]);
  });

  it("formats nmap service and script context without debug-only fields", () => {
    const fields = createFindingSourceContextFields({
      sourceTool: "nmap",
      kind: "nmap.script_signal",
      payload: {
        artifactItemPath: "$.hosts[0].ports[0].scripts[0]",
        host: "example.com",
        protocol: "tcp",
        port: "443",
        service: {
          name: "https",
          product: "nginx",
          version: "1.24.0",
          cpes: ["cpe:/a:nginx:nginx:1.24.0"],
        },
        scriptId: "ssl-cert",
        output: "Subject: commonName=example.com",
        outputHash: "hidden-debug-value",
      },
    });

    expect(fields).toContainEqual({ label: "Product", value: "nginx" });
    expect(fields).toContainEqual({ label: "Script ID", value: "ssl-cert" });
    expect(fields).toContainEqual({
      label: "Script Output",
      value: "Subject: commonName=example.com",
    });
    expect(fields.some((field) => field.value === "hidden-debug-value")).toBe(false);
  });

  it("formats nuclei payloads with a compact references preview", () => {
    const fields = createFindingSourceContextFields({
      sourceTool: "nuclei",
      kind: "nuclei.http",
      payload: {
        artifactFindingIndex: 2,
        artifactItemPath: "$.findings[2]",
        templateId: "cves/2024/example",
        matchedAt: "https://example.com/login",
        type: "http",
        sourceSeverity: "high",
        tags: ["cve", "exposure"],
        description: "A useful scanner description.",
        references: [
          "https://one.test",
          "https://two.test",
          "https://three.test",
          "https://four.test",
        ],
        matcherName: "status",
        extractorName: "version",
        ip: "203.0.113.10",
        port: "443",
      },
    });

    expect(fields).toContainEqual({ label: "Artifact Index", value: "2" });
    expect(fields).toContainEqual({
      label: "Template ID",
      value: "cves/2024/example",
    });
    expect(fields).toContainEqual({
      label: "References",
      value: "https://one.test, https://two.test, https://three.test, +1 more",
    });
  });

  it("falls back to compact JSON for unknown payload shapes", () => {
    const fields = createFindingSourceContextFields({
      sourceTool: "custom",
      kind: "custom.finding",
      payload: {
        nested: {
          value: true,
        },
      },
    });

    expect(fields).toEqual([
      {
        label: "JSON Preview",
        value: '{"nested":{"value":true}}',
      },
    ]);
  });

  it("truncates long source context values", () => {
    const fields = createFindingSourceContextFields({
      sourceTool: "nmap",
      kind: "nmap.script_signal",
      payload: {
        scriptId: "banner",
        output: "a".repeat(220),
      },
    });

    const output = fields.find((field) => field.label === "Script Output");

    expect(output?.value).toHaveLength(160);
    expect(output?.value.endsWith("...")).toBe(true);
  });
});
