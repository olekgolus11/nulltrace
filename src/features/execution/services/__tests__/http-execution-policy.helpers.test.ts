import { describe, expect, test } from "bun:test";
import {
  assertVerifiedFirewall,
  compileProxyFirewall,
  compileSquidConfiguration,
  compileWorkerFirewall,
  createHttpExecutionNetworkPolicy,
} from "../http-execution-policy.helpers";

const endpoints = [
  { origin: "https://example.test", hostname: "example.test", address: "93.184.216.34", family: 4 as const, port: 443 },
  { origin: "https://example.test", hostname: "example.test", address: "2606:2800:220:1:248:1893:25c8:1946", family: 6 as const, port: 443 },
];

describe("HTTP execution network policy", () => {
  test("compiles exact host, protocol, port and pinned addresses", () => {
    const policy = createHttpExecutionNetworkPolicy("run-1", ["https://example.test"], endpoints);
    const squid = compileSquidConfiguration(policy);
    const firewall = compileProxyFirewall("172.29.10.10", "fd71:1:1:1::10", policy.endpoints);
    expect(squid.configuration).toContain("dstdomain -n example.test");
    expect(squid.configuration).toContain("port 443");
    expect(squid.configuration).toContain("method CONNECT");
    expect(squid.configuration).toContain("http_access deny all");
    expect(squid.configuration).not.toContain("https://example.test");
    expect(squid.hosts).toContain("93.184.216.34 example.test");
    expect(firewall).toContain("ip daddr 93.184.216.34 tcp dport 443 accept");
    expect(firewall).toContain("ip6 daddr 2606:2800:220:1:248:1893:25c8:1946 tcp dport 443 accept");
    expect(firewall).toContain("policy drop");
    expect(compileWorkerFirewall("172.29.10.20", "fd71:1:1:1::20")).toContain("tcp dport 3128 accept");
  });

  test.each([
    { origins: ["https://example.test/path"], endpoints },
    { origins: ["https://example.test"], endpoints: [{ ...endpoints[0]!, hostname: "other.test" }] },
    { origins: ["https://example.test"], endpoints: [{ ...endpoints[0]!, port: 80 }] },
    { origins: ["https://example.test"], endpoints: [{ ...endpoints[0]!, family: 6 as const }] },
    { origins: ["https://example.test"], endpoints: [{ ...endpoints[0]!, address: "169.254.169.254" }] },
    { origins: ["https://example.test"], endpoints: [{ ...endpoints[0]!, address: "224.0.0.1" }] },
    { origins: ["https://example.test"], endpoints: [{ ...endpoints[1]!, address: "fe80::1" }] },
    { origins: ["https://example.test"], endpoints: [{ ...endpoints[1]!, address: "fd00:ec2::254" }] },
    { origins: ["https://example.test"], endpoints: [{ ...endpoints[1]!, address: "::ffff:127.0.0.1" }] },
  ])("rejects scope expansion or infrastructure destinations", ({ origins, endpoints }) => {
    expect(() => createHttpExecutionNetworkPolicy("run-1", origins, endpoints)).toThrow();
  });

  test("allows only an explicitly trusted non-public target while still pinning it", () => {
    const endpoint = [
      { origin: "http://internal.test:8080", hostname: "internal.test", address: "192.168.1.20", family: 4, port: 8080 },
    ] as const;
    expect(() => createHttpExecutionNetworkPolicy("run-1", ["http://internal.test:8080"], endpoint)).toThrow();
    const policy = createHttpExecutionNetworkPolicy("run-1", ["http://internal.test:8080"], endpoint, {
      "internal.test": ["192.168.1.20"],
    });
    expect(policy.endpoints[0]!.address).toBe("192.168.1.20");
    expect(() => createHttpExecutionNetworkPolicy("run-1", ["http://internal.test:8080"], endpoint, {
      "other.test": ["192.168.1.20"],
    })).toThrow();
    expect(() => createHttpExecutionNetworkPolicy("run-1", ["http://metadata:80"], [{
      origin: "http://metadata:80", hostname: "metadata", address: "169.254.169.254", family: 4, port: 80,
    }], { metadata: ["169.254.169.254"] })).toThrow();
    expect(() => createHttpExecutionNetworkPolicy("run-1", ["http://localhost:8080"], [{
      origin: "http://localhost:8080", hostname: "localhost", address: "127.0.0.1", family: 4, port: 8080,
    }], { localhost: ["127.0.0.1"] })).toThrow();
  });

  test("requires all default-drop chains and expected allow rules in kernel output", () => {
    const nftables = [
      { table: { family: "inet", name: "nulltrace" } },
      ...["input", "forward", "output"].map((name) => ({ chain: { family: "inet", table: "nulltrace", name, policy: "drop" } })),
      { rule: { table: "nulltrace", expr: [{ match: { right: "93.184.216.34" } }, { match: { right: 443 } }, { accept: null }] } },
    ];
    expect(() => assertVerifiedFirewall({ nftables }, { addresses: ["93.184.216.34"], ports: [443], minimumAcceptRules: 1 })).not.toThrow();
    expect(() => assertVerifiedFirewall({ nftables: nftables.filter((record) => !("chain" in record) || record.chain.name !== "output") }, {
      addresses: ["93.184.216.34"], ports: [443], minimumAcceptRules: 1,
    })).toThrow();
  });
});
