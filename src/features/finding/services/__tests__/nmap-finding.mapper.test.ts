import { describe, expect, it } from "bun:test";
import { ToolRunArtifactRecord } from "../../../session/model/session.repository.types";
import { nmapFindingMapper } from "../mappers/nmap-finding.mapper";

function createArtifact(payload: unknown): ToolRunArtifactRecord {
  return {
    id: "artifact-1",
    toolRunId: "run-1",
    artifactType: "nmap_scan",
    label: "Nmap scan",
    source: "nmap.xml",
    payload,
    createdAt: "2026-05-10T10:00:00.000Z",
  };
}

describe("nmapFindingMapper", () => {
  it("creates info open port findings for open ports only", () => {
    const findings = nmapFindingMapper.mapArtifact(
      createArtifact({
        hosts: [
          {
            hostnames: [{ name: "example.com", type: "user" }],
            addresses: [{ address: "45.33.32.156", type: "ipv4" }],
            ports: [
              {
                protocol: "tcp",
                port: "443",
                state: { state: "open", reason: "syn-ack" },
              },
              {
                protocol: "tcp",
                port: "444",
                state: { state: "closed", reason: "reset" },
              },
            ],
          },
        ],
      }),
    );

    expect(findings).toHaveLength(1);
    expect(findings[0]).toMatchObject({
      sourceTool: "nmap",
      kind: "nmap.open_port",
      severity: "info",
      title: "Open tcp/443 on example.com",
      summary: "Nmap detected open tcp/443 on example.com.",
      target: "example.com:443",
      dedupeKeyParts: ["example.com", "tcp", "443"],
      payload: {
        artifactItemPath: "$.hosts[0].ports[0]",
        host: "example.com",
        protocol: "tcp",
        port: "443",
        state: "open",
        reason: "syn-ack",
      },
    });
  });

  it("skips bare obvious service names but maps richer service detections", () => {
    const findings = nmapFindingMapper.mapArtifact(
      createArtifact({
        hosts: [
          {
            addresses: [{ address: "45.33.32.156", type: "ipv4" }],
            ports: [
              {
                protocol: "tcp",
                port: "80",
                state: { state: "open" },
                service: { name: "http", cpes: [] },
              },
              {
                protocol: "tcp",
                port: "22",
                state: { state: "open" },
                service: {
                  name: "ssh",
                  product: "OpenSSH",
                  version: "8.9p1",
                  extraInfo: "Ubuntu",
                  cpes: ["cpe:/a:openbsd:openssh:8.9p1"],
                },
              },
            ],
          },
        ],
      }),
    );

    expect(findings.map((finding) => finding.kind)).toEqual([
      "nmap.open_port",
      "nmap.open_port",
      "nmap.service_detected",
    ]);
    expect(findings[2]).toMatchObject({
      kind: "nmap.service_detected",
      severity: "info",
      title: "OpenSSH 8.9p1 Ubuntu detected on 45.33.32.156:22",
      summary: "Nmap detected OpenSSH 8.9p1 Ubuntu on tcp/22 at 45.33.32.156.",
      target: "45.33.32.156:22",
      dedupeKeyParts: [
        "45.33.32.156",
        "tcp",
        "22",
        "ssh",
        "OpenSSH",
        "8.9p1",
        "Ubuntu",
        "",
        "cpe:/a:openbsd:openssh:8.9p1",
      ],
      payload: {
        artifactItemPath: "$.hosts[0].ports[1].service",
        service: {
          name: "ssh",
          product: "OpenSSH",
          version: "8.9p1",
          extraInfo: "Ubuntu",
          cpes: ["cpe:/a:openbsd:openssh:8.9p1"],
        },
      },
    });
  });

  it("maps surprising bare service and port pairings", () => {
    const findings = nmapFindingMapper.mapArtifact(
      createArtifact({
        hosts: [
          {
            addresses: [{ address: "10.0.0.5", type: "ipv4" }],
            ports: [
              {
                protocol: "tcp",
                port: "2222",
                state: { state: "open" },
                service: { name: "ssh", cpes: [] },
              },
            ],
          },
        ],
      }),
    );

    expect(findings.map((finding) => finding.kind)).toEqual([
      "nmap.open_port",
      "nmap.service_detected",
    ]);
    expect(findings[1]).toMatchObject({
      title: "ssh detected on 10.0.0.5:2222",
      summary: "Nmap detected ssh on tcp/2222 at 10.0.0.5.",
    });
  });

  it("creates host-level and port-level script signal findings", () => {
    const findings = nmapFindingMapper.mapArtifact(
      createArtifact({
        hosts: [
          {
            hostnames: [{ name: "example.com", type: "user" }],
            ports: [
              {
                protocol: "tcp",
                port: "443",
                state: { state: "open" },
                scripts: [
                  {
                    id: "ssl-cert",
                    output: "Subject: commonName=example.com",
                  },
                ],
              },
              {
                protocol: "tcp",
                port: "444",
                state: { state: "closed" },
                scripts: [
                  {
                    id: "closed-port-script",
                    output: "script still produced output",
                  },
                ],
              },
            ],
            scripts: [
              {
                id: "hostmap",
                output: "example.com resolves to 45.33.32.156",
              },
            ],
          },
        ],
      }),
    );

    expect(findings.map((finding) => finding.kind)).toEqual([
      "nmap.script_signal",
      "nmap.open_port",
      "nmap.script_signal",
      "nmap.script_signal",
    ]);
    expect(findings[0]).toMatchObject({
      title: "Nmap script hostmap reported output on example.com",
      target: "example.com",
      payload: {
        artifactItemPath: "$.hosts[0].scripts[0]",
        host: "example.com",
        protocol: null,
        port: null,
        scriptId: "hostmap",
      },
    });
    expect(findings[2]).toMatchObject({
      title: "Nmap script ssl-cert reported output on example.com:443",
      target: "example.com:443",
      payload: {
        artifactItemPath: "$.hosts[0].ports[0].scripts[0]",
        host: "example.com",
        protocol: "tcp",
        port: "443",
        scriptId: "ssl-cert",
      },
    });
    expect(
      (findings[2].payload as { outputHash: string }).outputHash,
    ).toHaveLength(64);
    expect(findings[3]).toMatchObject({
      title:
        "Nmap script closed-port-script reported output on example.com:444",
      target: "example.com:444",
      payload: {
        artifactItemPath: "$.hosts[0].ports[1].scripts[0]",
        protocol: "tcp",
        port: "444",
      },
    });
  });

  it("uses deterministic fallback values and stable dedupe parts", () => {
    const artifact = createArtifact({
      hosts: [
        {
          ports: [
            {
              state: { state: "open" },
              scripts: [{ output: "anonymous output" }],
            },
          ],
        },
      ],
    });
    const first = nmapFindingMapper.mapArtifact(artifact);
    const second = nmapFindingMapper.mapArtifact(artifact);

    expect(first).toHaveLength(2);
    expect(first[0]).toMatchObject({
      title: "Open tcp/unknown on unknown-host",
      summary: "Nmap detected open tcp/unknown on unknown-host.",
      target: "unknown-host:unknown",
      dedupeKeyParts: ["unknown-host", "tcp", "unknown"],
    });
    expect(first[1]).toMatchObject({
      title:
        "Nmap script unknown-script reported output on unknown-host:unknown",
      summary:
        "Nmap script unknown-script reported output on unknown-host:unknown.",
    });
    expect(second.map((finding) => finding.dedupeKeyParts)).toEqual(
      first.map((finding) => finding.dedupeKeyParts),
    );
  });

  it("returns no candidates for non-object payloads", () => {
    expect(nmapFindingMapper.mapArtifact(createArtifact(null))).toEqual([]);
  });
});
