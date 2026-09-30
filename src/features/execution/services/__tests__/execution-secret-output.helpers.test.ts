import { describe, expect, test } from "bun:test";
import { isBoundedSanitizedOutput, parseSanitizedAuthenticatedContext, stripExecutionTerminalControls } from "../execution-secret-output.helpers";

describe("trusted secret output preparation", () => {
  test("requires an exact bounded cookie and header context schema", () => {
    const valid = new TextEncoder().encode(JSON.stringify({ cookies: "session=canary", headers: "Authorization: Bearer token" }));
    expect(parseSanitizedAuthenticatedContext(valid, "https://example.test")?.cookies).toBe("session=canary");
    expect(parseSanitizedAuthenticatedContext(new TextEncoder().encode("{\"cookies\":\"a=b\",\"cookies\":\"c=d\",\"headers\":\"\"}"), "https://example.test")).toBeNull();
    expect(parseSanitizedAuthenticatedContext(new TextEncoder().encode(JSON.stringify({ cookies: "bad\ncookie", headers: "" })), "https://example.test")).toBeNull();
    expect(parseSanitizedAuthenticatedContext(valid, "https://example.test/path")).toBeNull();
    expect(parseSanitizedAuthenticatedContext(new Uint8Array(64 * 1024 + 1), "https://example.test")).toBeNull();
    expect(parseSanitizedAuthenticatedContext(new TextEncoder().encode(JSON.stringify({ cookies: "", headers: "" })), "https://example.test")).toBeNull();
  });

  test("normalizes terminal control and bidi sequences before value matching", () => {
    expect(stripExecutionTerminalControls("Bearer \u001b[31msecret\u001b[0m\u202e")).toBe("Bearer secret");
    expect(stripExecutionTerminalControls("safe\u001b]0;unfinished" )).toBe("");
  });

  test("bounds complete output bytes, lines, and UTF-8 line size before retention", () => {
    expect(isBoundedSanitizedOutput({ stdout: "é\n", stderr: "status" }, 32)).toBe(true);
    expect(isBoundedSanitizedOutput({ stdout: "x\n".repeat(2_001), stderr: "" }, 100_000)).toBe(false);
    expect(isBoundedSanitizedOutput({ stdout: "é".repeat(2_049), stderr: "" }, 10_000)).toBe(false);
    expect(isBoundedSanitizedOutput({ stdout: "x\n".repeat(20), stderr: "" }, 8)).toBe(false);
    expect(isBoundedSanitizedOutput({ stdout: "safe\u001b[31munsafe", stderr: "" }, 100)).toBe(false);
  });
});
