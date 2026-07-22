import { describe, expect, it } from "bun:test";
import { ToolRunArtifactRecord } from "../../../session/model/session.repository.types";
import { nucleiFindingMapper } from "../mappers/nuclei-finding.mapper";

function createArtifact(payload: unknown): ToolRunArtifactRecord {
  return {
    id: "artifact-1",
    toolRunId: "run-1",
    artifactType: "nuclei_findings",
    label: "Nuclei findings",
    source: "nuclei.jsonl",
    payload,
    createdAt: "2026-05-10T10:00:00.000Z",
  };
}

describe("nucleiFindingMapper", () => {
  it("maps one session finding candidate per nuclei artifact finding", () => {
    const findings = nucleiFindingMapper.mapArtifact(
      createArtifact({
        findings: [
          {
            templateId: "cves/2024/test",
            name: "Example exposure",
            severity: "high",
            matchedAt: "https://example.com/login",
            type: "http",
            tags: ["cve", "exposure"],
            description: "A useful description",
            references: ["https://example.com/advisory"],
            raw: {
              "matcher-name": "status",
              "extractor-name": "version",
              host: "https://example.com",
              ip: "203.0.113.10",
              port: 443,
              scheme: "https",
              "template-id": "cves/2024/test",
            },
          },
          {
            templateId: "dns/takeover",
            name: "DNS takeover signal",
            severity: "medium",
            matchedAt: "example.com",
            type: "dns",
            tags: ["dns"],
            references: [],
            raw: {},
          },
        ],
      }),
    );

    expect(findings).toHaveLength(2);
    expect(findings[0]).toMatchObject({
      sourceTool: "nuclei",
      kind: "nuclei.http",
      severity: "high",
      title: "Example exposure",
      summary: "A useful description",
      target: "https://example.com/login",
      dedupeKeyParts: ["cves/2024/test", "https://example.com/login", "status", "version"],
      payload: {
        artifactFindingIndex: 0,
        artifactItemPath: "$.findings[0]",
        templateId: "cves/2024/test",
        matchedAt: "https://example.com/login",
        type: "http",
        sourceSeverity: "high",
        tags: ["cve", "exposure"],
        description: "A useful description",
        references: ["https://example.com/advisory"],
        matcherName: "status",
        extractorName: "version",
        host: "https://example.com",
        ip: "203.0.113.10",
        port: "443",
        scheme: "https",
      },
    });
    expect(findings[0].payload).not.toHaveProperty("raw");
    expect(findings[1]).toMatchObject({
      kind: "nuclei.dns",
      title: "DNS takeover signal",
      target: "example.com",
      payload: {
        artifactFindingIndex: 1,
        artifactItemPath: "$.findings[1]",
      },
    });
  });

  it("uses deterministic title and summary fallbacks", () => {
    const findings = nucleiFindingMapper.mapArtifact(
      createArtifact({
        findings: [
          {
            templateId: "ssl/self-signed",
            name: null,
            severity: null,
            matchedAt: "https://example.com",
            type: null,
            tags: [],
            description: null,
            references: [],
            raw: {},
          },
          {
            templateId: null,
            name: null,
            severity: "low",
            matchedAt: "https://example.org",
            type: null,
            tags: [],
            description: null,
            references: [],
            raw: {},
          },
        ],
      }),
    );

    expect(findings[0]).toMatchObject({
      title: "ssl/self-signed",
      summary: "Nuclei reported ssl/self-signed on https://example.com.",
    });
    expect(findings[1]).toMatchObject({
      title: "Nuclei finding on https://example.org",
      summary: "Nuclei reported a low finding on https://example.org.",
    });
  });

  it("falls back to info severity, meaningful tags, and stable targets", () => {
    const artifact = createArtifact({
      findings: [
        {
          templateId: "legacy/cve-test",
          name: null,
          severity: "unexpected",
          matchedAt: null,
          type: null,
          tags: ["cve", "legacy"],
          description: null,
          references: [],
          raw: {
            host: "https://fallback.example.com",
          },
        },
      ],
    });
    const first = nucleiFindingMapper.mapArtifact(artifact);
    const second = nucleiFindingMapper.mapArtifact(artifact);

    expect(first).toHaveLength(1);
    expect(first[0]).toMatchObject({
      kind: "nuclei.cve",
      severity: "info",
      target: "https://fallback.example.com",
      summary: "Nuclei reported legacy/cve-test on https://fallback.example.com.",
      payload: {
        sourceSeverity: "unexpected",
        tags: ["cve", "legacy"],
      },
    });
    expect(second[0]?.dedupeKeyParts).toEqual(first[0]?.dedupeKeyParts);
  });

  it("uses the generic nuclei finding kind when type and tags are absent", () => {
    const findings = nucleiFindingMapper.mapArtifact(
      createArtifact({
        findings: [
          {
            templateId: null,
            name: null,
            severity: null,
            matchedAt: null,
            type: null,
            tags: [],
            description: null,
            references: [],
            raw: {},
          },
        ],
      }),
    );

    expect(findings[0]).toMatchObject({
      kind: "nuclei.finding",
      severity: "info",
      title: "Nuclei finding on unknown-target",
      summary: "Nuclei reported a finding on unknown-target.",
      target: "unknown-target",
      dedupeKeyParts: ["unknown-template", "unknown-target", "", ""],
    });
  });

  it("returns no candidates for non-object payloads", () => {
    expect(nucleiFindingMapper.mapArtifact(createArtifact(null))).toEqual([]);
  });
});
