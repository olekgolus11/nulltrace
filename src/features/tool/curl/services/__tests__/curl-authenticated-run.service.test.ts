import { describe, expect, test } from "bun:test";
import { mkdtempSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { CurlAuthenticatedRunService } from "../curl-authenticated-run.service";

describe("CurlAuthenticatedRunService", () => {
  test("injects credentials through a temporary protected config and redacts output", async () => {
    const rootDirectory = mkdtempSync(join(tmpdir(), "nulltrace-curl-test-"));
    const service = new CurlAuthenticatedRunService({
      rootDirectory,
      isProceedAllowed: () => true,
      contextService: {
        getAuthStateVersion: () => 1,
        loadProtectedContext: async () => ({
          origin: "https://example.com",
          cookies: "session=hidden-cookie",
          headers: "Authorization: Bearer hidden-token\nX-Tenant: acme",
          updatedAt: "2026-08-12T00:00:00.000Z",
        }),
      },
    });

    const prepared = await service.prepare({
      sessionId: "session-1",
      targetUrl: "https://example.com/path",
      command: "curl https://example.com/path",
    });
    const configPath = prepared.command.match(/--config '([^']+)'/)?.[1];

    expect(configPath).toBeTruthy();
    const config = readFileSync(configPath!, "utf8");
    expect(config).toContain("Authorization: Bearer hidden-token");
    expect(config).toContain("cookie = \"session=hidden-cookie\"");
    expect(prepared.command).not.toContain("hidden-token");
    expect(prepared.redactOutput("Bearer hidden-token session=hidden-cookie")).not.toContain(
      "hidden-token",
    );
    prepared.cleanup();
  });

  test("rejects authentication from another exact origin", async () => {
    const service = new CurlAuthenticatedRunService({
      rootDirectory: mkdtempSync(join(tmpdir(), "nulltrace-curl-test-")),
      isProceedAllowed: () => true,
      contextService: {
        getAuthStateVersion: () => 1,
        loadProtectedContext: async () => ({
          origin: "https://login.example.com",
          cookies: "session=secret",
          headers: "",
          updatedAt: "2026-08-12T00:00:00.000Z",
        }),
      },
    });

    await expect(
      service.prepare({
        sessionId: "session-1",
        targetUrl: "https://example.com/path",
        command: "curl https://example.com/path",
      }),
    ).rejects.toThrow("exact origin");
  });
});

