import { describe, expect, test } from "bun:test";
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
    ).toBe("'curl' 'https://example.com/' -H '[redacted]' -b '[redacted]'");
    expect(
      curlCommandService.redactCommandForPersistence(
        "curl https://example.com --data-binary 'private payload'",
      ),
    ).toContain("--data-binary '[redacted]'");
  });

  test("keeps the method and safe target path while hiding query and inline values", () => {
    const command = curlCommandService.redactCommandForPersistence(
      "curl -X POST --url='https://example.com/path?q=query-canary#frag-canary' -H=X-Api:header-canary --data-raw=body-canary",
    );
    expect(command).toContain("-X 'POST'");
    expect(command).toContain("https://example.com/path?[redacted]#[redacted]");
    expect(command).not.toContain("query-canary");
    expect(command).not.toContain("frag-canary");
    expect(command).not.toContain("header-canary");
    expect(command).not.toContain("body-canary");
  });

  test("rejects multiple target inputs rather than silently choosing one", async () => {
    for (const command of [
      "curl https://example.com/a --url https://example.com/b",
      "curl --url=https://example.com/a --url=https://example.com/b",
    ]) {
      await expect(curlCommandService.prepareCommandForRun({
        command,
        sessionId: "session-1",
        toolRunId: "run-1",
        targetUrl: "https://example.com/root",
      })).rejects.toThrow("exactly one target URL");
    }
  });
});
