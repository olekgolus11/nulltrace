import { describe, expect, test } from "bun:test";
import {
  parseCurlWorkerConfiguration,
  quoteCurlConfigValue,
  readCurlWorkerStream,
  redactCurlWorkerHeaders,
  redactCurlWorkerOutput,
} from "../curl-worker.helpers";

const configuration = {
  version: 1,
  targetUrl: "http://127.0.0.1:8080/path?token=query-canary&encoded=%71uery-canary",
  exactOrigin: "http://127.0.0.1:8080",
  method: "POST",
  headers: ["X-Test: header-canary"],
  bodyOperations: [{ kind: "data-raw", value: "body-canary" }],
  maximumRedirectCount: 5,
  maximumResponseBytes: 2 * 1024 * 1024,
  timeoutSeconds: 10,
};

describe("cURL worker request configuration", () => {
  test("accepts bounded inline request fields and redacts echoed values", () => {
    const parsed = parseCurlWorkerConfiguration(configuration);
    expect(parsed.method).toBe("POST");
    const output = redactCurlWorkerOutput("query-canary header-canary body-canary", parsed);
    expect(output).not.toContain("query-canary");
    expect(output).not.toContain("header-canary");
    expect(output).not.toContain("body-canary");
  });

  test("rejects other origins, unsupported schema, secret headers, and @ file bodies", () => {
    expect(() => parseCurlWorkerConfiguration({ ...configuration, targetUrl: "http://other.test/path" }))
      .toThrow("approved exact origin");
    expect(() => parseCurlWorkerConfiguration({ ...configuration, headers: ["Authorization: canary"] }))
      .toThrow("Sensitive or transport-level");
    expect(() => parseCurlWorkerConfiguration({
      ...configuration,
      bodyOperations: [{ kind: "data-binary", value: "@/tmp/body" }],
    })).toThrow("Invalid inline");
    expect(() => parseCurlWorkerConfiguration({ ...configuration, extra: true })).toThrow("Invalid cURL request configuration");
  });

  test("escapes config directives and enforces the joined body byte limit", () => {
    const escaped = quoteCurlConfigValue('one"\ntwo\\three');
    expect(escaped).toBe('"one\\"\\ntwo\\\\three"');
    const maximumBody = "x".repeat(256 * 1024);
    expect(parseCurlWorkerConfiguration({
      ...configuration,
      bodyOperations: [{ kind: "data-raw", value: maximumBody }],
    }).bodyOperations[0]?.value).toBe(maximumBody);
    expect(() => parseCurlWorkerConfiguration({
      ...configuration,
      bodyOperations: [
        { kind: "data", value: "x".repeat(128 * 1024) },
        { kind: "data", value: "x".repeat(128 * 1024) },
      ],
    })).toThrow("body exceeded its limit");
  });

  test("redacts redirect query values and sensitive response headers", () => {
    const parsed = parseCurlWorkerConfiguration(configuration);
    const headers = redactCurlWorkerHeaders(
      "HTTP/1.1 302 Found\r\nLocation: /next?token=redirect-canary\r\nSet-Cookie: session-canary\r\nX-Note: safe\r\n",
      parsed.exactOrigin,
    );
    expect(headers).toContain("Location: http://127.0.0.1:8080/next?[redacted]");
    expect(headers).toContain("Set-Cookie: [redacted]");
    expect(redactCurlWorkerOutput("redirect-canary", parsed, ["redirect-canary"])).toBe("[redacted]");
  });

  test("cancels an output stream when the fixed pipe limit is exceeded", async () => {
    let cancelled = false;
    const stream = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(new Uint8Array(5));
      },
      cancel() { cancelled = true; },
    });
    await expect(readCurlWorkerStream(stream, 4, () => undefined)).rejects.toThrow("status output exceeded");
    expect(cancelled).toBe(true);
  });
});
