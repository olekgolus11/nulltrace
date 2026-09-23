import { isIP } from "node:net";
import { HttpExecutionEndpoint, HttpExecutionNetworkPolicy } from "../types/http-execution-network.types";
import { requireExecutionId } from "./execution-validation.helpers";

const MAXIMUM_ORIGINS = 32;
const MAXIMUM_ENDPOINTS = 128;
const MAXIMUM_TRUSTED_MAPPINGS = 32;
const MAXIMUM_MAPPING_ADDRESSES = 16;
const PROXY_PORT = 3128;
const MAXIMUM_ORIGIN_LENGTH = 2048;
const MAXIMUM_HOSTNAME_LENGTH = 253;

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
): HttpExecutionNetworkPolicy {
  requireExecutionId(executionId);
  if (!origins.length || origins.length > MAXIMUM_ORIGINS || !endpoints.length || endpoints.length > MAXIMUM_ENDPOINTS) {
    throw new Error("Invalid HTTP network policy size.");
  }
  const normalizedOrigins = origins.map(parseOrigin);
  if (new Set(normalizedOrigins.map((origin) => origin.origin)).size !== normalizedOrigins.length) {
    throw new Error("Duplicate HTTP origin.");
  }
  const allowedOrigins = new Map(normalizedOrigins.map((origin) => [origin.origin, origin]));
  const mappingEntries = Object.entries(trustedNonPublicMappings);
  if (mappingEntries.length > MAXIMUM_TRUSTED_MAPPINGS) throw new Error("Too many trusted non-public host mappings.");
  const trustedAddresses = new Map(mappingEntries.map(([hostname, addresses]) => {
    const normalizedHostname = normalizeHostname(hostname);
    if (!addresses.length || addresses.length > MAXIMUM_MAPPING_ADDRESSES) throw new Error("Invalid trusted host mapping.");
    return [normalizedHostname, new Set(addresses.map((address) => {
      const normalizedAddress = normalizeNetworkAddress(address);
      if (isForbiddenInfrastructureAddress(normalizedAddress)) throw new Error("Invalid trusted infrastructure address.");
      return normalizedAddress;
    }))];
  }));
  const keys = new Set<string>();
  const normalizedEndpoints = endpoints.map((endpoint) => {
    const origin = parseOrigin(endpoint.origin);
    const allowed = allowedOrigins.get(origin.origin);
    const address = normalizeNetworkAddress(endpoint.address);
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
    ip daddr ${proxyIpv4} tcp dport ${PROXY_PORT} accept
    ip6 daddr ${proxyIpv6} tcp dport ${PROXY_PORT} accept
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

export function compileProxyFirewall(workerIpv4: string, workerIpv6: string, endpoints: readonly HttpExecutionEndpoint[]): string {
  requireAddress(workerIpv4, 4);
  requireAddress(workerIpv6, 6);
  if (!endpoints.length) throw new Error("Proxy requires endpoints.");
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
    ip saddr ${workerIpv4} tcp dport ${PROXY_PORT} accept
    ip6 saddr ${workerIpv6} tcp dport ${PROXY_PORT} accept
    ip6 hoplimit 255 icmpv6 type { nd-neighbor-solicit, nd-neighbor-advert } accept
  }
  chain forward { type filter hook forward priority 0; policy drop; }
  chain output {
    type filter hook output priority 0; policy drop;
    ct state established,related accept
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
    configuration: `http_port ${PROXY_PORT}
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
  requirements: { addresses: string[]; ports: number[]; minimumAcceptRules: number },
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
}

function parseOrigin(value: string): { origin: string; hostname: string; port: number; protocol: "http:" | "https:" } {
  if (typeof value !== "string" || value.length > MAXIMUM_ORIGIN_LENGTH) throw new Error("Invalid HTTP origin.");
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
  if (!hostname || hostname.length > MAXIMUM_HOSTNAME_LENGTH || /[\s\x00-\x1f\x7f]/.test(hostname)) throw new Error("Invalid HTTP hostname.");
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
