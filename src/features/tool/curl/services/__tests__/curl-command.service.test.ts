import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { curlMaximumResponseBytes } from "../../config/curl.config";
import { curlCommandService } from "../curl-command.service";

describe("curlCommandService", () => {
  test("builds all supported methods and JSON requests", () => {
    let toolData = curlCommandService.createInitialToolData("https://example.com/api");
    for (const method of [
      "GET",
      "HEAD",
      "POST",
      "PUT",
      "PATCH",
      "DELETE",
      "OPTIONS",
    ] as const) {
      toolData = curlCommandService.setField(toolData, "method", method);
      expect(curlCommandService.buildCommand(toolData)).toContain(`-X ${method}`);
    }

    toolData = curlCommandService.setField(toolData, "bodyMode", "json");
    toolData = curlCommandService.setField(toolData, "body", '{"active":true}');
    expect(curlCommandService.buildCommand(toolData)).toContain(
      "-H 'Content-Type: application/json' --data-raw '{\"active\":true}'",
    );
  });

  test("enforces timeout, response cap, TLS verification, and fail-closed redirects", async () => {
    const toolData = curlCommandService.createInitialToolData("https://example.com/api");
    const prepared = await curlCommandService.prepareCommandForRun({
      command: curlCommandService.buildCommand(toolData),
      sessionId: "session-1",
      toolRunId: "run-1",
      targetUrl: "https://example.com/root",
      toolData,
    });

    const input = readPreparedExecutionInput(prepared.command);
    expect(input.timeoutSeconds).toBe(30);
    expect(input.maximumResponseBytes).toBe(curlMaximumResponseBytes);
    expect(input.maximumRedirectCount).toBe(5);
    expect(prepared.command).not.toMatch(/(?:^|\s)(?:-k|--insecure)(?:\s|$)/);
    expect(prepared.timeoutMs).toBe(30_000);
    expect(prepared.systemLines?.join(" ")).toContain("exact session origin only");
    prepared.cleanup?.();
  });

  test("rejects cross-origin requests, unsafe redirects, shell syntax, and credentials", async () => {
    for (const command of [
      "curl https://api.example.com/path",
      "curl https://example.com/path -L",
      "curl https://example.com/path --max-redirs 5",
      "curl https://user:password@example.com/path",
      "curl https://example.com/path; printf leaked",
      "curl $(printf https://example.com/path)",
      'curl https://example.com/path --data-raw "$HOME"',
      'curl https://example.com/path --data-raw "`whoami`"',
      "curl https://example.com/path -H 'Authorization: Bearer secret'",
      "curl https://example.com/path -H 'X-Api-Key: secret'",
      "curl https://example.com/path -H 'Host: internal.example'",
      "curl https://example.com/path -H @/etc/passwd",
      "curl https://example.com/path --data-binary @/etc/passwd",
    ]) {
      await expect(
        curlCommandService.prepareCommandForRun({
          command,
          sessionId: "session-1",
          toolRunId: "run-1",
          targetUrl: "https://example.com/root",
        }),
      ).rejects.toThrow();
    }
  });

  test("accepts another path on the session target exact origin", async () => {
    const prepared = await curlCommandService.prepareCommandForRun({
      command: "curl -X GET 'https://example.com:443/another-path?x=1'",
      sessionId: "session-1",
      toolRunId: "run-1",
      targetUrl: "https://example.com/root",
    });

    expect(readPreparedExecutionInput(prepared.command).targetUrl).toContain("another-path?x=1");
    prepared.cleanup?.();
  });

  test("rejects request bodies larger than 256 KiB by UTF-8 byte length", async () => {
    const body = "ą".repeat(131_073);
    await expect(
      curlCommandService.prepareCommandForRun({
        command: `curl -X POST https://example.com --data-binary '${body}'`,
        sessionId: "session-1",
        toolRunId: "run-1",
        targetUrl: "https://example.com",
      }),
    ).rejects.toThrow("256 KiB");
  });

  test("requires valid JSON when JSON mode is selected", async () => {
    let toolData = curlCommandService.createInitialToolData("https://example.com");
    toolData = curlCommandService.setField(toolData, "bodyMode", "json");
    toolData = curlCommandService.setField(toolData, "body", "{invalid");

    await expect(
      curlCommandService.prepareCommandForRun({
        command: curlCommandService.buildCommand(toolData),
        sessionId: "session-1",
        toolRunId: "run-1",
        targetUrl: "https://example.com",
        toolData,
      }),
    ).rejects.toThrow("valid JSON");
  });

  test("redacts manually supplied credentials before persistence", () => {
    expect(
      curlCommandService.redactCommandForPersistence(
        "curl https://example.com -H 'Authorization: Bearer secret' -b 'session=secret'",
      ),
    ).toBe("'curl' 'https://example.com' -H '[redacted]' -b '[redacted]'");
    expect(
      curlCommandService.redactCommandForPersistence(
        "curl https://example.com --data-binary 'private payload'",
      ),
    ).toContain("--data-binary '[redacted]'");
  });
});

function readPreparedExecutionInput(command: string) {
  const path = command.match(/'([^']+\/execution\.json)'$/)?.[1];
  if (!path) throw new Error("Missing execution config path.");
  return JSON.parse(readFileSync(path, "utf8")) as {
    targetUrl: string;
    timeoutSeconds: number;
    maximumResponseBytes: number;
    maximumRedirectCount: number;
  };
}
