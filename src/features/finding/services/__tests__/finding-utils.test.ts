import { describe, expect, it } from "bun:test";
import { normalizeFindingSeverity } from "../finding-severity";
import { createFindingFingerprint } from "../finding-fingerprint";

describe("createFindingFingerprint", () => {
  it("returns the same hash for the same input", () => {
    const first = createFindingFingerprint("nmap", "open_port", [
      "scanme.nmap.org",
      "443/tcp",
    ]);
    const second = createFindingFingerprint("nmap", "open_port", [
      "scanme.nmap.org",
      "443/tcp",
    ]);

    expect(first).toBe(second);
  });

  it("returns a different hash when source tool, kind, or key parts change", () => {
    const base = createFindingFingerprint("nmap", "open_port", [
      "scanme.nmap.org",
      "443/tcp",
    ]);
    const differentTool = createFindingFingerprint("nuclei", "open_port", [
      "scanme.nmap.org",
      "443/tcp",
    ]);
    const differentKind = createFindingFingerprint("nmap", "service", [
      "scanme.nmap.org",
      "443/tcp",
    ]);
    const differentKeyParts = createFindingFingerprint("nmap", "open_port", [
      "scanme.nmap.org",
      "80/tcp",
    ]);

    expect(base).not.toBe(differentTool);
    expect(base).not.toBe(differentKind);
    expect(base).not.toBe(differentKeyParts);
  });
});

describe("normalizeFindingSeverity", () => {
  it("normalizes known severities", () => {
    expect(normalizeFindingSeverity("critical")).toBe("critical");
    expect(normalizeFindingSeverity(" HIGH ")).toBe("high");
    expect(normalizeFindingSeverity("info")).toBe("info");
  });

  it("falls back to info for missing or unknown severity", () => {
    expect(normalizeFindingSeverity(undefined)).toBe("info");
    expect(normalizeFindingSeverity(null)).toBe("info");
    expect(normalizeFindingSeverity("unexpected")).toBe("info");
  });
});
