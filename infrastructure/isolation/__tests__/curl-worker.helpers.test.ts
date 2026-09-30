import { describe, expect, test } from "bun:test";
import { ExecutionEventBufferService } from "../../../src/features/execution/services/execution-event-buffer.service";
import {
  parseCurlWorkerConfiguration,
  quoteCurlConfigValue,
  readCurlWorkerStream,
  redactCurlWorkerHeaders,
} from "../curl-worker.helpers";
import {
  curlWorkerOutputLimits,
  formatCurlWorkerDiagnostics,
  formatCurlWorkerResponse,
  parseCurlWorkerWriteout,
  redactCurlWorkerOutput,
} from "../curl-worker-output.helpers";
import { CurlWorkerConfiguration } from "../curl-worker.types";

const configuration: CurlWorkerConfiguration = {
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

  test("keeps a bounded preview and final status through broker event replay for a 2 MiB line", () => {
    const lines = formatCurlWorkerResponse(
      "",
      "x".repeat(2 * 1024 * 1024),
      "200",
      "0.125000",
      configuration.targetUrl,
      configuration,
    );
    expect(lines.at(-1)).toBe("[http 200] 0.125000s http://127.0.0.1:8080/path?[redacted]");
    expect(lines.some((line) => line.includes("response body truncated by output limit"))).toBe(true);
    expect(lines.every((line) => Buffer.byteLength(line) <= curlWorkerOutputLimits.maximumLineBytes)).toBe(true);
    expect(lines.reduce((total, line) => total + Buffer.byteLength(line) + 1, 0))
      .toBeLessThan(curlWorkerOutputLimits.maximumTranscriptBytes);

    const events = new ExecutionEventBufferService("curl-output", 1024 * 1024);
    events.append("stdout", Buffer.from(`${lines.join("\n")}\n`));
    events.finish();
    const replayed: string[] = [];
    let cursor = -1;
    while (true) {
      const page = events.read(cursor, 100);
      replayed.push(...page.events.map((event) => event.line));
      if (!page.hasMore) break;
      cursor = page.nextSequence;
    }
    expect(replayed.at(-1)).toBe(lines.at(-1));
    expect(replayed.some((line) => line.includes("[output truncated by isolation limit]"))).toBe(false);
  });

  test("keeps footer metadata intact when request values overlap status and timing text", () => {
    const lexicalValues: CurlWorkerConfiguration = {
      ...configuration,
      bodyOperations: [
        { kind: "data-raw", value: "200" },
        { kind: "data-raw", value: "s" },
      ],
    };
    const lines = formatCurlWorkerResponse("", "echo 200 s", "200", "0.000125", configuration.targetUrl, lexicalValues);
    expect(lines.at(-1)).toBe("[http 200] 0.000125s http://127.0.0.1:8080/path?[redacted]");
    expect(lines[0]).toBe("echo [redacted] [redacted]");
  });

  test("bounds many response lines and redaction expansion while retaining the footer", () => {
    const lines = formatCurlWorkerResponse(
      "",
      "x\n".repeat(100_000),
      "204",
      "1.5",
      configuration.targetUrl,
      { ...configuration, bodyOperations: [{ kind: "data-raw", value: "x" }] },
    );
    expect(lines.at(-1)).toContain("[http 204] 1.5s");
    expect(lines).toHaveLength(curlWorkerOutputLimits.maximumBodyLines + 2);
    expect(lines.some((line) => line.includes("response body truncated by output limit"))).toBe(true);
    expect(lines.every((line) => Buffer.byteLength(line) <= curlWorkerOutputLimits.maximumLineBytes)).toBe(true);
    expect(lines.reduce((total, line) => total + Buffer.byteLength(line) + 1, 0))
      .toBeLessThan(curlWorkerOutputLimits.maximumTranscriptBytes);
  });

  test("redacts canaries across preview boundaries and preserves complete UTF-8 characters", () => {
    const boundaryBody = `${"b".repeat(curlWorkerOutputLimits.maximumBodyBytes - 5)}body-canary`;
    const boundaryLines = formatCurlWorkerResponse("", boundaryBody, "200", "2", configuration.targetUrl, configuration);
    expect(boundaryLines.join("\n")).not.toContain("body-canary");
    expect(boundaryLines.at(-1)).toContain("[http 200] 2s");

    const unicodeLines = formatCurlWorkerResponse("", `${"a".repeat(3_499)}💡`, "200", "0.1", configuration.targetUrl, configuration);
    expect(unicodeLines[0]).toBe("a".repeat(3_499));
    expect(unicodeLines[1]).toBe("💡");
    expect(unicodeLines.join("")).not.toContain("�");
  });

  test("bounds diagnostics and validates write-out fields before rendering", () => {
    const diagnostics = formatCurlWorkerDiagnostics("d".repeat(100_000), configuration);
    expect(diagnostics.at(-1)).toContain("diagnostics truncated by output limit");
    expect(diagnostics.reduce((total, line) => total + Buffer.byteLength(line) + 1, 0))
      .toBeLessThan(curlWorkerOutputLimits.maximumDiagnosticBytes + 100);
    expect(parseCurlWorkerWriteout("201\t0.25")).toEqual(["201", "0.25"]);
    expect(parseCurlWorkerWriteout("200\tInfinity\thttps://secret.test/?token=secret")).toEqual(["000", "0"]);
  });

  test("keeps aggregate transcript bytes and event count below broker retention limits", () => {
    const responseLines = formatCurlWorkerResponse(
      `X-Long: ${"h".repeat(63 * 1024)}`,
      "b".repeat(2 * 1024 * 1024),
      "206",
      "1.250000",
      configuration.targetUrl,
      configuration,
    );
    const diagnosticLines = formatCurlWorkerDiagnostics("d".repeat(8 * 1024), configuration);
    const allLines = [...responseLines, ...diagnosticLines];
    const transcriptBytes = allLines.reduce((total, line) => total + Buffer.byteLength(line) + 1, 0);
    expect(transcriptBytes).toBeLessThan(curlWorkerOutputLimits.maximumTranscriptBytes);
    expect(allLines.length).toBeLessThan(2_000);
    expect(allLines.every((line) => Buffer.byteLength(line) <= curlWorkerOutputLimits.maximumLineBytes)).toBe(true);
    expect(responseLines.at(-1)).toContain("[http 206] 1.250000s");
  });

  test("drops incomplete terminal controls before the reserved HTTP footer", () => {
    const lines = formatCurlWorkerResponse("", `safe\u001b]0;attacker-controlled`, "200", "0.5", configuration.targetUrl, configuration);
    expect(lines.at(-1)).toContain("[http 200] 0.5s");
    expect(lines.join("\n")).not.toContain("attacker-controlled");
  });
});
