import { describe, expect, it } from "bun:test";
import { normalizeTargetUrl } from "../session-url";

describe("normalizeTargetUrl", () => {
  it("treats hostnames beginning with http as hostnames", () => {
    expect(normalizeTargetUrl("httpd.example.com/path/")).toBe(
      "https://httpd.example.com/path",
    );
  });

  it("rejects explicit non-HTTP schemes", () => {
    expect(() => normalizeTargetUrl("ftp://example.com")).toThrow(
      "Target URL must use HTTP or HTTPS.",
    );
  });
});
