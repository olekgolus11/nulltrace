import { isIP } from "node:net";
import {
  HttpExecutionEndpoint,
  HttpExecutionFirewallRequirements,
  HttpExecutionNetworkPolicy,
  HttpReservedControlEndpoint,
} from "../types/http-execution-network.types";
import { requireExecutionId } from "./execution-validation.helpers";

const forbiddenIpv4 = [
  ["0.0.0.0", 8],
  ["10.0.0.0", 8],
  ["100.64.0.0", 10],
  ["127.0.0.0", 8],
  ["169.254.0.0", 16],
  ["172.16.0.0", 12],
  ["192.0.0.0", 24],
  ["192.0.2.0", 24],
  ["192.168.0.0", 16],
  ["198.18.0.0", 15],
  ["198.51.100.0", 24],
  ["203.0.113.0", 24],
  ["224.0.0.0", 4],
  ["240.0.0.0", 4],
] as const;

export function createHttpExecutionNetworkPolicy(
  executionId: string,
  origins: readonly string[],
  endpoints: readonly HttpExecutionEndpoint[],
  trustedNonPublicMappings: Readonly<Record<string, readonly string[]>> = {},
  reservedControlEndpoints: readonly HttpReservedControlEndpoint[] = [],
): HttpExecutionNetworkPolicy {
  requireExecutionId(executionId);
  if (!origins.length || origins.length > 32 || !endpoints.length || endpoints.length > 128) {
    throw new Error("Invalid HTTP network policy size.");
  }
  const normalizedOrigins = origins.map(parseOrigin);
  if (new Set(normalizedOrigins.map((origin) => origin.origin)).size !== normalizedOrigins.length) {
    throw new Error("Duplicate HTTP origin.");
  }
  const allowedOrigins = new Map(normalizedOrigins.map((origin) => [origin.origin, origin]));
  const mappingEntries = Object.entries(trustedNonPublicMappings);
  if (mappingEntries.length > 32) throw new Error("Too many trusted non-public host mappings.");
  const trustedAddresses = new Map(mappingEntries.map(([hostname, addresses]) => {
    const normalizedHostname = normalizeHostname(hostname);
    if (!addresses.length || addresses.length > 16) throw new Error("Invalid trusted host mapping.");
    return [normalizedHostname, new Set(addresses.map((address) => {
      const normalizedAddress = normalizeNetworkAddress(address);
      if (isForbiddenInfrastructureAddress(normalizedAddress)) throw new Error("Invalid trusted infrastructure address.");
      return normalizedAddress;
    }))];
  }));
  const reservedEndpoints = snapshotReservedControlEndpoints(reservedControlEndpoints);
  const keys = new Set<string>();
  const normalizedEndpoints = endpoints.map((endpoint) => {
    const origin = parseOrigin(endpoint.origin);
    const allowed = allowedOrigins.get(origin.origin);
    const address = normalizeNetworkAddress(endpoint.address);
    if (isReservedControlEndpoint(address, endpoint.port, reservedEndpoints)) {
      throw new Error("Target endpoint conflicts with a reserved control endpoint.");
    }
    if (!allowed || normalizeHostname(endpoint.hostname) !== allowed.hostname || endpoint.port !== allowed.port ||
      endpoint.family !== isIP(address) ||
      isForbiddenInfrastructureAddress(address) ||
      (isNonPublicAddress(address) && !trustedAddresses.get(allowed.hostname)?.has(address))) {
      throw new Error("Endpoint does not match an approved HTTP origin.");
    }
    const key = `${origin.origin}|${address}`;
    if (keys.has(key)) throw new Error("Duplicate HTTP endpoint.");
    keys.add(key);
    return { ...endpoint, origin: origin.origin, hostname: allowed.hostname, address };
  });
  for (const origin of normalizedOrigins) {
    if (!normalizedEndpoints.some((endpoint) => endpoint.origin === origin.origin)) {
      throw new Error("Every origin requires a pinned endpoint.");
    }
  }
  return {
    executionId,
    origins: normalizedOrigins.map((origin) => origin.origin),
    endpoints: normalizedEndpoints,
  };
}

export function snapshotReservedControlEndpoints(
  endpoints: unknown = [],
): readonly HttpReservedControlEndpoint[] {
  if (!Array.isArray(endpoints) || endpoints.length > 8) {
    throw new Error("Invalid reserved control endpoint list.");
  }
  let totalAddresses = 0;
  const tuples = new Set<string>();
  const snapshots = endpoints.map((value: unknown) => {
    const endpoint = value as Partial<HttpReservedControlEndpoint> & Record<string, unknown>;
    if (!endpoint || typeof endpoint !== "object" || Array.isArray(endpoint) ||
        Object.keys(endpoint).length !== 2 || !Object.hasOwn(endpoint, "addresses") || !Object.hasOwn(endpoint, "port") ||
        !Array.isArray(endpoint.addresses) || endpoint.addresses.length < 1 || endpoint.addresses.length > 16 ||
        typeof endpoint.port !== "number" ||
        !Number.isSafeInteger(endpoint.port) || endpoint.port < 1 || endpoint.port > 65_535) {
      throw new Error("Invalid reserved control endpoint.");
    }
    totalAddresses += endpoint.addresses.length;
    if (totalAddresses > 32) throw new Error("Too many reserved control endpoint addresses.");
    const addresses = endpoint.addresses.map((address: unknown) => {
      if (typeof address !== "string" || isIP(address) === 0) throw new Error("Invalid reserved control endpoint address.");
      const normalized = normalizeNetworkAddress(address);
      if (isForbiddenReservationAddress(normalized)) throw new Error("Invalid reserved control endpoint address.");
      const tuple = `${normalized}|${endpoint.port}`;
      if (tuples.has(tuple)) throw new Error("Duplicate reserved control endpoint tuple.");
      tuples.add(tuple);
      return normalized;
    });
    if (new Set(addresses).size !== addresses.length) throw new Error("Duplicate reserved control endpoint address.");
    return Object.freeze({ addresses: Object.freeze(addresses), port: endpoint.port });
  });
  return Object.freeze(snapshots);
}

function isReservedControlEndpoint(
  address: string,
  port: number,
  reservations: readonly HttpReservedControlEndpoint[],
): boolean {
  return reservations.some((reservation) => reservation.port === port && reservation.addresses.includes(address));
}

function isForbiddenReservationAddress(address: string): boolean {
  const family = isIP(address);
  if (family === 4) {
    return address === "0.0.0.0" || address === "255.255.255.255" || inIpv4Network(address, "224.0.0.0", 4);
  }
  return address === "::" || address.toLowerCase().startsWith("ff") || address.toLowerCase().startsWith("::ffff:");
}

export function compileWorkerFirewall(proxyIpv4: string, proxyIpv6: string): string {
  requireAddress(proxyIpv4, 4);
  requireAddress(proxyIpv6, 6);
  return `flush ruleset
table inet nulltrace {
  chain input {
    type filter hook input priority 0; policy drop;
    ct state established,related accept
    ip6 saddr ${proxyIpv6} ip6 hoplimit 255 icmpv6 type { nd-neighbor-solicit, nd-neighbor-advert } accept
  }
  chain forward { type filter hook forward priority 0; policy drop; }
  chain output {
    type filter hook output priority 0; policy drop;
    ct state established,related accept
    ip daddr ${proxyIpv4} tcp dport 3128 accept
    ip6 daddr ${proxyIpv6} tcp dport 3128 accept
    ip6 daddr ff02::1:ff00:20 ip6 hoplimit 255 icmpv6 type nd-neighbor-solicit accept
  }
}
`;
}

export function normalizeNetworkAddress(value: string): string {
  const family = isIP(value);
  if (family === 4) return value;
  if (family === 6) return new URL(`http://[${value}]`).hostname.slice(1, -1);
  throw new Error("Invalid network address.");
}

export function compileProxyFirewall(
  workerIpv4: string,
  workerIpv6: string,
  endpoints: readonly HttpExecutionEndpoint[],
  reservedControlEndpoints: readonly HttpReservedControlEndpoint[] = [],
): string {
  requireAddress(workerIpv4, 4);
  requireAddress(workerIpv6, 6);
  if (!endpoints.length) throw new Error("Proxy requires endpoints.");
  const reservations = snapshotReservedControlEndpoints(reservedControlEndpoints);
  const reservedRules = reservations.flatMap(({ addresses, port }) => addresses.map((address) =>
    `    ${isIP(address) === 4 ? "ip" : "ip6"} daddr ${address} tcp dport ${port} drop\n`,
  )).join("");
  const ipv4Rules = endpointRules(endpoints, 4, "ip");
  const ipv6Rules = endpointRules(endpoints, 6, "ip6");
  const ipv6Neighbors = [...new Set(endpoints.filter((endpoint) => endpoint.family === 6).map((endpoint) => endpoint.address))]
    .map((address) => `    ip6 daddr ${solicitedNodeAddress(address)} ip6 hoplimit 255 icmpv6 type nd-neighbor-solicit accept`)
    .join("\n");
  return `flush ruleset
table inet nulltrace {
  chain input {
    type filter hook input priority 0; policy drop;
    ct state established,related accept
    ip saddr ${workerIpv4} tcp dport 3128 accept
    ip6 saddr ${workerIpv6} tcp dport 3128 accept
    ip6 hoplimit 255 icmpv6 type { nd-neighbor-solicit, nd-neighbor-advert } accept
  }
  chain forward { type filter hook forward priority 0; policy drop; }
  chain output {
    type filter hook output priority 0; policy drop;
${reservedRules}    ct state established,related accept
${ipv4Rules}${ipv6Rules}${ipv6Neighbors ? `${ipv6Neighbors}\n` : ""}  }
}
`;
}

export function compileSquidConfiguration(policy: HttpExecutionNetworkPolicy): { configuration: string; hosts: string } {
  const origins = policy.origins.map(parseOrigin);
  const hosts = [...new Set(policy.endpoints.map((endpoint) => `${endpoint.address} ${endpoint.hostname}`))].join("\n") + "\n";
  const aclLines: string[] = [];
  const allowLines: string[] = [];
  origins.forEach((origin, index) => {
    const name = `origin_${index}`;
    aclLines.push(`acl ${name}_host dstdomain -n ${origin.hostname}`);
    aclLines.push(`acl ${name}_port port ${origin.port}`);
    if (origin.protocol === "https:") {
      aclLines.push(`acl ${name}_method method CONNECT`);
      allowLines.push(`http_access allow ${name}_host ${name}_port ${name}_method`);
    } else {
      aclLines.push(`acl ${name}_protocol proto HTTP`);
      allowLines.push(`http_access allow ${name}_host ${name}_port ${name}_protocol`);
    }
  });
  return {
    hosts,
    configuration: `http_port 3128
visible_hostname nulltrace-execution-proxy
pid_filename /work/squid.pid
cache_log /work/cache.log
cache_store_log none
cache deny all
cache_mem 8 MB
pinger_enable off
hosts_file /work/hosts
dns_nameservers 127.0.0.1
host_verify_strict on
connect_timeout 5 seconds
request_timeout 30 seconds
shutdown_lifetime 1 seconds
${aclLines.join("\n")}
${allowLines.join("\n")}
http_access deny all
logformat decisions %ts.%03tu %>a %Ss/%03>Hs %rm %>A
access_log stdio:/work/access.log decisions
`,
  };
}

export function assertVerifiedFirewall(
  value: unknown,
  requirements: HttpExecutionFirewallRequirements,
): void {
  if (!value || typeof value !== "object" || !Array.isArray((value as { nftables?: unknown }).nftables)) {
    throw new Error("Firewall verification failed.");
  }
  const records = (value as { nftables: unknown[] }).nftables;
  for (const chain of ["input", "forward", "output"]) {
    const found = records.some((record) => {
      if (!record || typeof record !== "object") return false;
      const candidate = (record as { chain?: unknown }).chain;
      return Boolean(candidate && typeof candidate === "object" &&
        (candidate as { family?: unknown }).family === "inet" &&
        (candidate as { table?: unknown }).table === "nulltrace" &&
        (candidate as { name?: unknown }).name === chain &&
        (candidate as { policy?: unknown }).policy === "drop");
    });
    if (!found) {
      throw new Error("Firewall default-drop policy is missing.");
    }
  }
  const encoded = JSON.stringify(value);
  if (requirements.addresses.some((address) => !encoded.includes(address)) ||
    requirements.ports.some((port) => !encoded.includes(String(port))) ||
    encoded.match(/"accept"/g)?.length === undefined ||
    (encoded.match(/"accept"/g)?.length ?? 0) < requirements.minimumAcceptRules) {
    throw new Error("Firewall allow rules do not match the compiled policy.");
  }
  const reservations = snapshotReservedControlEndpoints(requirements.reservedControlEndpoints ?? []);
  if (reservations.length === 0) return;
  const outputRules = records.flatMap((record, index) => {
    if (!isRecord(record) || !isRecord(record.rule)) return [];
    const rule = record.rule;
    if (rule.family !== "inet" || rule.table !== "nulltrace" || rule.chain !== "output") return [];
    return [{ index, expressions: Array.isArray(rule.expr) ? rule.expr : [] }];
  });
  const expectedDenies = reservations.flatMap(({ addresses, port }) => addresses.map((address) => ({
    address,
    family: isIP(address) === 4 ? "ip" : "ip6",
    port,
  })));
  if (outputRules.length < expectedDenies.length || expectedDenies.some(({ address, family, port }, index) => {
    const expressions = outputRules[index]?.expressions;
    return !expressions || expressions.length !== 3 ||
      !matchesPayload(expressions[0], family, "daddr", address) ||
      !matchesPayload(expressions[1], "tcp", "dport", port) ||
      !isDropExpression(expressions[2]);
  })) {
    throw new Error("Reserved control endpoint firewall deny is missing or shadowed.");
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value && typeof value === "object" && !Array.isArray(value));
}

function matchesPayload(value: unknown, protocol: string, field: string, expected: string | number): boolean {
  if (!isRecord(value) || !isRecord(value.match) || !isRecord(value.match.left) ||
      !isRecord(value.match.left.payload) || Object.keys(value.match).length !== 3 ||
      Object.keys(value.match.left).length !== 1 || Object.keys(value.match.left.payload).length !== 2) return false;
  return value.match.op === "==" && value.match.left.payload.protocol === protocol && value.match.left.payload.field === field &&
    value.match.right === expected;
}

function isDropExpression(value: unknown): boolean {
  return isRecord(value) && Object.keys(value).length === 1 && value.drop === null;
}

function parseOrigin(value: string): { origin: string; hostname: string; port: number; protocol: "http:" | "https:" } {
  if (typeof value !== "string" || value.length > 2048) throw new Error("Invalid HTTP origin.");
  const url = new URL(value);
  if ((url.protocol !== "http:" && url.protocol !== "https:") || url.origin !== value || url.username || url.password) {
    throw new Error("HTTP origins must be normalized.");
  }
  return {
    origin: url.origin,
    hostname: normalizeHostname(url.hostname),
    port: Number(url.port || (url.protocol === "https:" ? 443 : 80)),
    protocol: url.protocol,
  };
}

function normalizeHostname(value: string): string {
  const hostname = value.startsWith("[") && value.endsWith("]") ? value.slice(1, -1) : value;
  if (!hostname || hostname.length > 253 || /[\s\x00-\x1f\x7f]/.test(hostname)) throw new Error("Invalid HTTP hostname.");
  return hostname.toLowerCase();
}

function endpointRules(endpoints: readonly HttpExecutionEndpoint[], family: 4 | 6, keyword: "ip" | "ip6"): string {
  return endpoints.filter((endpoint) => endpoint.family === family)
    .map((endpoint) => `    ${keyword} daddr ${endpoint.address} tcp dport ${endpoint.port} accept\n`)
    .join("");
}

function requireAddress(value: string, family: 4 | 6): void {
  if (isIP(value) !== family) throw new Error("Invalid network address.");
}

function isForbiddenInfrastructureAddress(address: string): boolean {
  const normalized = address.toLowerCase();
  if (isIP(address) === 4) {
    return address === "0.0.0.0" || address === "169.254.169.254" || address === "255.255.255.255" ||
      inIpv4Network(address, "127.0.0.0", 8) || inIpv4Network(address, "224.0.0.0", 4);
  }
  return normalized === "::" || normalized === "::1" || normalized === "fd00:ec2::254" ||
    normalized.startsWith("ff") || normalized.startsWith("::ffff:");
}

function isNonPublicAddress(address: string): boolean {
  if (isIP(address) === 4) return forbiddenIpv4.some(([network, prefix]) => inIpv4Network(address, network, prefix));
  const normalized = address.toLowerCase();
  return normalized === "::" || normalized === "::1" || normalized.startsWith("fe8") || normalized.startsWith("fe9") ||
    normalized.startsWith("fea") || normalized.startsWith("feb") || normalized.startsWith("fc") ||
    normalized.startsWith("fd") || normalized.startsWith("ff") || normalized.startsWith("2001:db8:") ||
    normalized.startsWith("::ffff:");
}

function inIpv4Network(address: string, network: string, prefix: number): boolean {
  const number = ipv4Number(address);
  const base = ipv4Number(network);
  const mask = prefix === 0 ? 0 : (0xffffffff << (32 - prefix)) >>> 0;
  return (number & mask) === (base & mask);
}

function ipv4Number(address: string): number {
  return address.split(".").reduce((value, octet) => ((value << 8) | Number(octet)) >>> 0, 0);
}

function solicitedNodeAddress(address: string): string {
  const expanded = expandIpv6(address);
  return `ff02::1:ff${expanded.slice(-6, -4)}:${expanded.slice(-4)}`;
}

function expandIpv6(address: string): string {
  const [left, right = ""] = address.split("::");
  const leftParts = left ? left.split(":") : [];
  const rightParts = right ? right.split(":") : [];
  const missing = 8 - leftParts.length - rightParts.length;
  if (missing < 0) throw new Error("Invalid IPv6 address.");
  return [...leftParts, ...Array(missing).fill("0"), ...rightParts].map((part) => part.padStart(4, "0")).join("");
}
