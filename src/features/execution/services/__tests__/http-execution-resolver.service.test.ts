import { describe, expect, test } from "bun:test";
import { HttpExecutionResolverService } from "../http-execution-resolver.service";

describe("trusted HTTP target resolution", () => {
  test("resolves once and pins all validated A and AAAA results", async () => {
    let calls = 0;
    const resolver = new HttpExecutionResolverService({
      trustedNonPublicMappings: {},
      async lookup(hostname) {
        calls++;
        expect(hostname).toBe("example.test");
        return [{ address: "93.184.216.34", family: 4 }, { address: "2606:2800:220:1:248:1893:25c8:1946", family: 6 }];
      },
    });
    const policy = await resolver.resolve("run-1", ["https://example.test"]);
    expect(calls).toBe(1);
    expect(policy.endpoints.map((endpoint) => endpoint.address)).toEqual([
      "93.184.216.34",
      "2606:2800:220:1:248:1893:25c8:1946",
    ]);
    expect(policy.endpoints.every((endpoint) => endpoint.port === 443)).toBe(true);
  });

  test("rejects private, metadata and mixed results unless the exact host mapping is trusted", async () => {
    const privateLookup = async () => [{ address: "192.168.1.20", family: 4 as const }];
    await expect(new HttpExecutionResolverService({ trustedNonPublicMappings: {}, lookup: privateLookup })
      .resolve("run-1", ["https://internal.test"])).rejects.toThrow();
    const trusted = new HttpExecutionResolverService({
      trustedNonPublicMappings: { "internal.test": ["192.168.1.20"] },
      lookup: privateLookup,
    });
    expect((await trusted.resolve("run-1", ["https://internal.test"])).endpoints[0]!.address).toBe("192.168.1.20");
    await expect(new HttpExecutionResolverService({
      trustedNonPublicMappings: { "internal.test": ["169.254.169.254"] },
      async lookup() { return [{ address: "169.254.169.254", family: 4 }]; },
    }).resolve("run-1", ["https://internal.test"])).rejects.toThrow();
  });

  test("rejects resolver output with wrong families or excessive addresses", async () => {
    await expect(new HttpExecutionResolverService({
      trustedNonPublicMappings: {},
      async lookup() { return [{ address: "93.184.216.34", family: 6 }]; },
    }).resolve("run-1", ["https://example.test"])).rejects.toThrow();
    await expect(new HttpExecutionResolverService({
      trustedNonPublicMappings: {},
      async lookup() { return Array.from({ length: 17 }, (_, index) => ({ address: `93.184.216.${index + 1}`, family: 4 as const })); },
    }).resolve("run-1", ["https://example.test"])).rejects.toThrow();
  });

  test("validates origins before DNS and bounds target resolution", async () => {
    let calls = 0;
    const resolver = new HttpExecutionResolverService({
      trustedNonPublicMappings: {},
      timeoutMs: 100,
      async lookup() {
        calls++;
        return new Promise(() => undefined);
      },
    });
    await expect(resolver.resolve("run-1", ["https://example.test/path"])).rejects.toThrow();
    expect(calls).toBe(0);
    await expect(resolver.resolve("run-1", ["https://example.test"])).rejects.toThrow("timed out");
  });
});
