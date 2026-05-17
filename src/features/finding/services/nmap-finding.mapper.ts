import { createHash } from "node:crypto";
import { FindingCandidate, FindingMapper } from "../model/finding.types";
import { ToolRunArtifactRecord } from "../../session/model/session.repository.types";

interface NmapScanPayload {
  hosts?: NmapHostPayload[];
}

interface NmapHostPayload {
  addresses?: NmapAddressPayload[];
  hostnames?: NmapHostnamePayload[];
  ports?: NmapPortPayload[];
  scripts?: NmapScriptPayload[];
}

interface NmapAddressPayload {
  address?: string | null;
  type?: string | null;
}

interface NmapHostnamePayload {
  name?: string | null;
  type?: string | null;
}

interface NmapPortPayload {
  protocol?: string | null;
  port?: string | null;
  state?: {
    state?: string | null;
    reason?: string | null;
  };
  service?: NmapServicePayload;
  scripts?: NmapScriptPayload[];
}

interface NmapServicePayload {
  name?: string | null;
  product?: string | null;
  version?: string | null;
  extraInfo?: string | null;
  osType?: string | null;
  method?: string | null;
  confidence?: string | null;
  cpes?: string[];
}

interface NmapScriptPayload {
  id?: string | null;
  output?: string | null;
}

const obviousServicesByPort: Record<string, string[]> = {
  "tcp/20": ["ftp-data"],
  "tcp/21": ["ftp"],
  "tcp/22": ["ssh"],
  "tcp/23": ["telnet"],
  "tcp/25": ["smtp"],
  "tcp/53": ["domain"],
  "udp/53": ["domain"],
  "tcp/80": ["http"],
  "tcp/110": ["pop3"],
  "tcp/143": ["imap"],
  "tcp/443": ["https", "ssl/http", "https-alt"],
  "tcp/465": ["smtps"],
  "tcp/587": ["submission"],
  "tcp/993": ["imaps"],
  "tcp/995": ["pop3s"],
  "tcp/3306": ["mysql"],
  "tcp/3389": ["ms-wbt-server", "rdp"],
  "tcp/5432": ["postgresql"],
  "tcp/6379": ["redis"],
  "tcp/8080": ["http-proxy", "http"],
  "tcp/8443": ["https-alt", "https"],
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function asArray<T>(value: T[] | undefined): T[] {
  return Array.isArray(value) ? value : [];
}

function normalizeText(value: string | null | undefined) {
  return value?.trim() || null;
}

function normalizeProtocol(value: string | null | undefined) {
  return normalizeText(value)?.toLowerCase() ?? "tcp";
}

function createStableHash(value: string) {
  return createHash("sha256").update(value).digest("hex");
}

function parseNmapScanPayload(payload: unknown): NmapScanPayload | null {
  if (!isRecord(payload)) {
    return null;
  }

  return payload as NmapScanPayload;
}

function getHostLabel(host: NmapHostPayload) {
  const hostname = asArray(host.hostnames)
    .map((candidate) => normalizeText(candidate.name))
    .find((candidate) => Boolean(candidate));

  if (hostname) {
    return hostname;
  }

  const address = asArray(host.addresses)
    .map((candidate) => normalizeText(candidate.address))
    .find((candidate) => Boolean(candidate));

  return address ?? "unknown-host";
}

function isOpenPort(port: NmapPortPayload) {
  return normalizeText(port.state?.state)?.toLowerCase() === "open";
}

function getPortTarget(hostLabel: string, port: NmapPortPayload) {
  const portNumber = normalizeText(port.port) ?? "unknown";
  return `${hostLabel}:${portNumber}`;
}

function getPortSignature(port: NmapPortPayload) {
  const protocol = normalizeProtocol(port.protocol);
  const portNumber = normalizeText(port.port) ?? "unknown";
  return `${protocol}/${portNumber}`;
}

function getServiceLabel(service: NmapServicePayload) {
  return [
    normalizeText(service.product),
    normalizeText(service.version),
    normalizeText(service.extraInfo),
  ]
    .filter(Boolean)
    .join(" ")
    .trim();
}

function hasRichServiceMetadata(service: NmapServicePayload) {
  return Boolean(
    normalizeText(service.product) ||
      normalizeText(service.version) ||
      normalizeText(service.extraInfo) ||
      normalizeText(service.osType) ||
      asArray(service.cpes).some((cpe) => Boolean(normalizeText(cpe))),
  );
}

function hasUnexpectedServicePairing(port: NmapPortPayload) {
  const serviceName = normalizeText(port.service?.name)?.toLowerCase();
  const portSignature = getPortSignature(port);

  if (!serviceName) {
    return false;
  }

  const obviousServices = obviousServicesByPort[portSignature];

  if (!obviousServices) {
    return true;
  }

  return !obviousServices.includes(serviceName);
}

function shouldCreateServiceFinding(port: NmapPortPayload) {
  const service = port.service;

  if (!service || !normalizeText(service.name)) {
    return false;
  }

  return hasRichServiceMetadata(service) || hasUnexpectedServicePairing(port);
}

function createOpenPortFinding(
  host: NmapHostPayload,
  port: NmapPortPayload,
  hostIndex: number,
  portIndex: number,
): FindingCandidate {
  const hostLabel = getHostLabel(host);
  const protocol = normalizeProtocol(port.protocol);
  const portNumber = normalizeText(port.port) ?? "unknown";
  const target = getPortTarget(hostLabel, port);
  const artifactItemPath = `$.hosts[${hostIndex}].ports[${portIndex}]`;

  return {
    sourceTool: "nmap",
    kind: "nmap.open_port",
    severity: "info",
    title: `Open ${protocol}/${portNumber} on ${hostLabel}`,
    summary: `Nmap detected open ${protocol}/${portNumber} on ${hostLabel}.`,
    target,
    dedupeKeyParts: [hostLabel, protocol, portNumber],
    payload: {
      artifactItemPath,
      host: hostLabel,
      protocol,
      port: portNumber,
      state: normalizeText(port.state?.state),
      reason: normalizeText(port.state?.reason),
    },
  };
}

function createServiceFinding(
  host: NmapHostPayload,
  port: NmapPortPayload,
  hostIndex: number,
  portIndex: number,
): FindingCandidate | null {
  const service = port.service;

  if (!service) {
    return null;
  }

  const hostLabel = getHostLabel(host);
  const protocol = normalizeProtocol(port.protocol);
  const portNumber = normalizeText(port.port) ?? "unknown";
  const serviceName = normalizeText(service.name) ?? "unknown";
  const serviceLabel = getServiceLabel(service) || serviceName;
  const target = getPortTarget(hostLabel, port);
  const artifactItemPath = `$.hosts[${hostIndex}].ports[${portIndex}].service`;
  const cpes = asArray(service.cpes).filter((cpe) => Boolean(normalizeText(cpe)));

  return {
    sourceTool: "nmap",
    kind: "nmap.service_detected",
    severity: "info",
    title: `${serviceLabel} detected on ${hostLabel}:${portNumber}`,
    summary: `Nmap detected ${serviceLabel} on ${protocol}/${portNumber} at ${hostLabel}.`,
    target,
    dedupeKeyParts: [
      hostLabel,
      protocol,
      portNumber,
      serviceName,
      normalizeText(service.product) ?? "",
      normalizeText(service.version) ?? "",
      normalizeText(service.extraInfo) ?? "",
      normalizeText(service.osType) ?? "",
      ...cpes,
    ],
    payload: {
      artifactItemPath,
      host: hostLabel,
      protocol,
      port: portNumber,
      service: {
        name: serviceName,
        product: normalizeText(service.product),
        version: normalizeText(service.version),
        extraInfo: normalizeText(service.extraInfo),
        osType: normalizeText(service.osType),
        method: normalizeText(service.method),
        confidence: normalizeText(service.confidence),
        cpes,
      },
    },
  };
}

function createScriptFinding(
  host: NmapHostPayload,
  script: NmapScriptPayload,
  hostIndex: number,
  scriptIndex: number,
  port?: NmapPortPayload,
  portIndex?: number,
): FindingCandidate {
  const hostLabel = getHostLabel(host);
  const scriptId = normalizeText(script.id) ?? "unknown-script";
  const output = normalizeText(script.output) ?? "";
  const outputHash = createStableHash(output);
  const protocol = port ? normalizeProtocol(port.protocol) : null;
  const portNumber = port ? normalizeText(port.port) ?? "unknown" : null;
  const target =
    port && portNumber ? getPortTarget(hostLabel, port) : hostLabel;
  const location =
    port && portNumber
      ? `${hostLabel}:${portNumber}`
      : hostLabel;
  const artifactItemPath =
    portIndex === undefined
      ? `$.hosts[${hostIndex}].scripts[${scriptIndex}]`
      : `$.hosts[${hostIndex}].ports[${portIndex}].scripts[${scriptIndex}]`;

  return {
    sourceTool: "nmap",
    kind: "nmap.script_signal",
    severity: "info",
    title: `Nmap script ${scriptId} reported output on ${location}`,
    summary: `Nmap script ${scriptId} reported output on ${location}.`,
    target,
    dedupeKeyParts: [
      hostLabel,
      protocol ?? "",
      portNumber ?? "",
      scriptId,
      outputHash,
    ],
    payload: {
      artifactItemPath,
      host: hostLabel,
      protocol,
      port: portNumber,
      scriptId,
      output,
      outputHash,
    },
  };
}

export const nmapFindingMapper: FindingMapper = {
  artifactType: "nmap_scan",
  mapArtifact(artifact: ToolRunArtifactRecord) {
    const payload = parseNmapScanPayload(artifact.payload);

    if (!payload) {
      return [];
    }

    return asArray(payload.hosts).flatMap((host, hostIndex) => {
      const hostScriptFindings = asArray(host.scripts).map(
        (script, scriptIndex) =>
          createScriptFinding(host, script, hostIndex, scriptIndex),
      );
      const portFindings = asArray(host.ports).flatMap((port, portIndex) => {
        const findings: FindingCandidate[] = isOpenPort(port)
          ? [createOpenPortFinding(host, port, hostIndex, portIndex)]
          : [];
        const serviceFinding =
          isOpenPort(port) && shouldCreateServiceFinding(port)
            ? createServiceFinding(host, port, hostIndex, portIndex)
            : null;

        if (serviceFinding) {
          findings.push(serviceFinding);
        }

        return [
          ...findings,
          ...asArray(port.scripts).map((script, scriptIndex) =>
            createScriptFinding(
              host,
              script,
              hostIndex,
              scriptIndex,
              port,
              portIndex,
            ),
          ),
        ];
      });

      return [...hostScriptFindings, ...portFindings];
    });
  },
};
