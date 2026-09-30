import { describe, expect, test } from "bun:test";
import {
  assertVerifiedFirewall,
  compileProxyFirewall,
  compileSquidConfiguration,
  compileWorkerFirewall,
  createHttpExecutionNetworkPolicy,
  snapshotReservedControlEndpoints,
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
    expect(squid.configuration).toContain("logformat decisions %ts.%03tu %>a %Ss/%03>Hs %rm %>A");
    expect(squid.configuration).not.toContain("%ru");
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

  test("rejects reserved control tuples across hostname aliases but allows another port", () => {
    const ipv4Reservation = [{ addresses: ["192.168.1.20"], port: 8443 }] as const;
    expect(() => createHttpExecutionNetworkPolicy("run-1", ["https://attacker.test:8443"], [{
      origin: "https://attacker.test:8443", hostname: "attacker.test", address: "192.168.1.20", family: 4, port: 8443,
    }], { "attacker.test": ["192.168.1.20"] }, ipv4Reservation)).toThrow("reserved control endpoint");

    const ipv6Reservation = [{ addresses: ["2001:0db8:0000:0000:0000:0000:0000:0001"], port: 9443 }] as const;
    expect(() => createHttpExecutionNetworkPolicy("run-1", ["https://alias.test:9443"], [{
      origin: "https://alias.test:9443", hostname: "alias.test", address: "2001:db8::1", family: 6, port: 9443,
    }], { "alias.test": ["2001:db8::1"] }, ipv6Reservation)).toThrow("reserved control endpoint");

    const otherPort = createHttpExecutionNetworkPolicy("run-1", ["https://attacker.test:8444"], [{
      origin: "https://attacker.test:8444", hostname: "attacker.test", address: "192.168.1.20", family: 4, port: 8444,
    }], { "attacker.test": ["192.168.1.20"] }, ipv4Reservation);
    expect(otherPort.endpoints[0]?.port).toBe(8444);
  });

  test.each([
    [{ addresses: [], port: 443 }],
    [{ addresses: ["0.0.0.0"], port: 443 }],
    [{ addresses: ["224.0.0.1"], port: 443 }],
    [{ addresses: ["::"], port: 443 }],
    [{ addresses: ["ff02::1"], port: 443 }],
    [{ addresses: ["::ffff:192.0.2.1"], port: 443 }],
    [{ addresses: ["192.0.2.1"], port: 0 }],
    [{ addresses: ["192.0.2.1"], port: 65_536 }],
    [{ addresses: ["192.0.2.1"], port: 443, extra: true }],
  ])("rejects malformed reserved endpoint configuration %#", (reservations) => {
    expect(() => snapshotReservedControlEndpoints(reservations)).toThrow();
  });

  test("places exact reserved tuple drops before established and target accepts", () => {
    const rules = compileProxyFirewall("172.29.10.10", "fd71:1:1:1::10", endpoints, [
      { addresses: ["93.184.216.34", "2606:2800:220:1:248:1893:25c8:1946"], port: 443 },
    ]);
    const output = rules.slice(rules.indexOf("chain output"));
    const ipv4Drop = output.indexOf("ip daddr 93.184.216.34 tcp dport 443 drop");
    const ipv6Drop = output.indexOf("ip6 daddr 2606:2800:220:1:248:1893:25c8:1946 tcp dport 443 drop");
    const established = output.indexOf("ct state established,related accept");
    const ipv4Accept = output.indexOf("ip daddr 93.184.216.34 tcp dport 443 accept");
    expect(ipv4Drop).toBeGreaterThan(-1);
    expect(ipv6Drop).toBeGreaterThan(ipv4Drop);
    expect(established).toBeGreaterThan(ipv6Drop);
    expect(ipv4Accept).toBeGreaterThan(established);
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

  test("requires exact reserved endpoint deny rules before every output accept", () => {
    const reservation = { addresses: ["192.0.2.7"], port: 8443 } as const;
    const rule = (expressions: unknown[]) => ({ rule: { family: "inet", table: "nulltrace", chain: "output", expr: expressions } });
    const addressMatch = { match: { op: "==", left: { payload: { protocol: "ip", field: "daddr" } }, right: "192.0.2.7" } };
    const portMatch = { match: { op: "==", left: { payload: { protocol: "tcp", field: "dport" } }, right: 8443 } };
    const accepted = rule([{ accept: null }]);
    const reservedDrop = rule([addressMatch, portMatch, { drop: null }]);
    const base = [
      { table: { family: "inet", name: "nulltrace" } },
      ...["input", "forward", "output"].map((name) => ({ chain: { family: "inet", table: "nulltrace", name, policy: "drop" } })),
    ];
    const requirements = { addresses: ["192.0.2.7"], ports: [8443], minimumAcceptRules: 1, reservedControlEndpoints: [reservation] };
    expect(() => assertVerifiedFirewall({ nftables: [...base, reservedDrop, accepted] }, requirements)).not.toThrow();
    expect(() => assertVerifiedFirewall({ nftables: [...base, accepted, rule([addressMatch, portMatch, { drop: null }])] }, requirements)).toThrow("missing or shadowed");
    expect(() => assertVerifiedFirewall({ nftables: [...base, rule([{ jump: { target: "other" } }]), reservedDrop, accepted] }, requirements)).toThrow("missing or shadowed");
    expect(() => assertVerifiedFirewall({ nftables: [...base, rule([addressMatch, { drop: null }]), accepted] }, requirements)).toThrow();
    expect(() => assertVerifiedFirewall({ nftables: [...base, rule([
      addressMatch,
      portMatch,
      { match: { op: "==", left: { payload: { protocol: "tcp", field: "sport" } }, right: 1234 } },
      { drop: null },
    ]), accepted] }, requirements)).toThrow("missing or shadowed");
    expect(() => assertVerifiedFirewall({ nftables: [...base, rule([
      { match: { ...addressMatch.match, op: "!=" } }, portMatch, { drop: null },
    ]), accepted] }, requirements)).toThrow("missing or shadowed");
    expect(() => assertVerifiedFirewall({ nftables: [...base, rule([addressMatch]), rule([portMatch, { drop: null }]), accepted] }, requirements)).toThrow("missing or shadowed");
    expect(() => assertVerifiedFirewall({ nftables: [...base, rule([addressMatch, portMatch, { accept: null }])] }, requirements)).toThrow("missing or shadowed");
    expect(() => assertVerifiedFirewall({ nftables: [...base, { rule: { ...reservedDrop.rule, chain: "input" } }, accepted] }, requirements)).toThrow("missing or shadowed");
    expect(() => assertVerifiedFirewall({ nftables: [...base, { rule: { ...reservedDrop.rule, family: "ip" } }, accepted] }, requirements)).toThrow("missing or shadowed");
  });
});
