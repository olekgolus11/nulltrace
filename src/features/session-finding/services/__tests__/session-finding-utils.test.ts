import { describe, expect, it } from "bun:test";
import { createSessionFindingFingerprint } from "../session-finding-fingerprint";
import { normalizeSessionFindingSeverity } from "../session-finding-severity";

describe("createSessionFindingFingerprint", () => {
  it("returns the same hash for the same input", () => {
    const first = createSessionFindingFingerprint("nmap", "open_port", [
      "scanme.nmap.org",
      "443/tcp",
    ]);
    const second = createSessionFindingFingerprint("nmap", "open_port", [
      "scanme.nmap.org",
      "443/tcp",
    ]);

    expect(first).toBe(second);
  });

  it("returns a different hash when source tool, kind, or key parts change", () => {
    const base = createSessionFindingFingerprint("nmap", "open_port", [
      "scanme.nmap.org",
      "443/tcp",
    ]);
    const differentTool = createSessionFindingFingerprint(
      "nuclei",
      "open_port",
      ["scanme.nmap.org", "443/tcp"],
    );
    const differentKind = createSessionFindingFingerprint("nmap", "service", [
      "scanme.nmap.org",
      "443/tcp",
    ]);
    const differentKeyParts = createSessionFindingFingerprint(
      "nmap",
      "open_port",
      ["scanme.nmap.org", "80/tcp"],
    );

    expect(base).not.toBe(differentTool);
    expect(base).not.toBe(differentKind);
    expect(base).not.toBe(differentKeyParts);
  });
});

describe("normalizeSessionFindingSeverity", () => {
  it("normalizes known severities", () => {
    expect(normalizeSessionFindingSeverity("critical")).toBe("critical");
    expect(normalizeSessionFindingSeverity(" HIGH ")).toBe("high");
    expect(normalizeSessionFindingSeverity("info")).toBe("info");
  });

  it("falls back to info for missing or unknown severity", () => {
    expect(normalizeSessionFindingSeverity(undefined)).toBe("info");
    expect(normalizeSessionFindingSeverity(null)).toBe("info");
    expect(normalizeSessionFindingSeverity("unexpected")).toBe("info");
  });
});
