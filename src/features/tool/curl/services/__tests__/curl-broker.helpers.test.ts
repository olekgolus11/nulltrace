import { describe, expect, test } from "bun:test";
import { validateCurlCommand } from "../curl-command.helpers";
import { buildCurlWorkerInput, createCurlWorkerPlan } from "../curl-broker.helpers";

describe("cURL broker adapter helpers", () => {
  test("preserves request method, ordered repeated bodies, and fixed worker policy", () => {
    const command = validateCurlCommand(
      "curl -X POST 'https://example.test/path?q=private' -H 'Accept: application/json' --data=one --data-raw=two --data-binary=three",
      "https://example.test/root",
    );
    const input = buildCurlWorkerInput(command, "https://example.test/root");

    expect(input).toMatchObject({
      targetUrl: "https://example.test/path?q=private",
      exactOrigin: "https://example.test",
      method: "POST",
      headers: ["Accept: application/json"],
      bodyOperations: [
        { kind: "data", value: "one" },
        { kind: "data-raw", value: "two" },
        { kind: "data-binary", value: "three" },
      ],
      maximumRedirectCount: 5,
      maximumResponseBytes: 2 * 1024 * 1024,
      timeoutSeconds: 30,
    });
  });

  test("uses immutable worker argv, exact origin, and release-owned limits", () => {
    const configuration = {
      directory: "/tmp/broker",
      principal: { installationId: "install", instanceId: "client" },
      clientToken: "a".repeat(64),
      adminToken: "b".repeat(64),
    };
    const plan = createCurlWorkerPlan("https://example.test/private?query-canary", configuration);

    expect(plan).toMatchObject({
      profileId: "public-curl-worker-v1",
      tool: "curl",
      mode: "public-worker",
      invocation: { executableId: "bun", argv: ["run", "/opt/nulltrace/workers/curl-worker.ts"] },
      origins: ["https://example.test"],
      inputs: [{ id: "curl-config", kind: "data", maximumBytes: 2 * 1024 * 1024 }],
      limits: { timeoutMs: 30_000, outputBytes: 1024 * 1024 },
    });
    expect(JSON.stringify(plan)).not.toContain("query-canary");
  });

  test("rejects ambiguous target tokens at the adapter boundary", () => {
    const command = validateCurlCommand("curl https://example.test/one", "https://example.test/root");
    command.tokens.push("--url", "https://example.test/two");
    expect(() => buildCurlWorkerInput(command, "https://example.test/root")).toThrow("exactly one target URL");
  });
});
