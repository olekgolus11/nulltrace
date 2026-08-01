import { afterEach, describe, expect, test } from "bun:test";
import { existsSync, mkdtempSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { SqlmapAuthenticatedRunService } from "../sqlmap-authenticated-run.service";

const temporaryDirectories: string[] = [];

function createTemporaryDirectory() {
  const directory = mkdtempSync(join(tmpdir(), "nulltrace-sqlmap-auth-test-"));
  temporaryDirectories.push(directory);
  return directory;
}

function createService(rootDirectory: string, sessionId = "session-1") {
  return new SqlmapAuthenticatedRunService({
    rootDirectory,
    contextService: {
      getAuthStateVersion: (requestedSessionId) => requestedSessionId === sessionId ? 4 : 0,
      loadProtectedContext: async (requestedSessionId) =>
        requestedSessionId === sessionId
          ? {
              origin: "https://example.com:8443",
              cookies: "session=secret-cookie; preference=compact",
              headers: "Authorization: Bearer secret-token\nX-Tenant: tenant-1",
              updatedAt: "2026-08-01T10:00:00.000Z",
            }
          : null,
    },
    isProceedAllowed: (requestedSessionId) => requestedSessionId === sessionId,
  });
}

afterEach(() => {
  for (const directory of temporaryDirectories.splice(0)) {
    rmSync(directory, { recursive: true, force: true });
  }
});

describe("SqlmapAuthenticatedRunService", () => {
  test("injects accepted exact-origin authentication through an owner-only raw request", async () => {
    const rootDirectory = createTemporaryDirectory();
    const prepared = await createService(rootDirectory).prepare({
      sessionId: "session-1",
      command:
        "sqlmap -u 'https://example.com:8443/products?id=1' --method GET -p id --level 1 --risk 1 --batch",
    });
    const rawRequest = readFileSync(prepared.secretFilePath, "utf8");

    expect(prepared.command).toContain(`-r '${prepared.secretFilePath}'`);
    expect(prepared.command).not.toContain("-u ");
    expect(prepared.command).not.toContain("secret-cookie");
    expect(prepared.command).not.toContain("secret-token");
    expect(rawRequest).toContain("GET /products?id=1 HTTP/1.1");
    expect(rawRequest).toContain("Host: example.com:8443");
    expect(rawRequest).toContain("Cookie: session=secret-cookie; preference=compact");
    expect(rawRequest).toContain("Authorization: Bearer secret-token");
    expect(statSync(rootDirectory).mode & 0o777).toBe(0o700);
    expect(statSync(dirname(prepared.secretFilePath)).mode & 0o777).toBe(0o700);
    expect(statSync(prepared.secretFilePath).mode & 0o777).toBe(0o600);
    expect(prepared.redactOutput(rawRequest)).not.toContain("secret-cookie");
    expect(prepared.redactArtifact(JSON.stringify({ value: "secret-token" }))).not.toContain(
      "secret-token",
    );

    prepared.cleanup();
    expect(existsSync(prepared.secretFilePath)).toBe(false);
  });

  test("preserves one POST endpoint and parameter in execution request", async () => {
    const rootDirectory = createTemporaryDirectory();
    const prepared = await createService(rootDirectory).prepare({
      sessionId: "session-1",
      command:
        "sqlmap -u 'https://example.com:8443/api/products' --method POST --data 'id=1&category=2' -p id --level 2 --risk 1",
    });
    const rawRequest = readFileSync(prepared.secretFilePath, "utf8");

    expect(rawRequest).toContain("POST /api/products HTTP/1.1");
    expect(rawRequest).toContain("Content-Type: application/x-www-form-urlencoded");
    expect(rawRequest).toEndWith("\r\n\r\nid=1&category=2");
    expect(prepared.command).not.toContain("--data");
    expect(prepared.command).toContain("-p 'id'");

    prepared.cleanup();
  });

  test("preserves JSON POST semantics and disables redirects", async () => {
    const rootDirectory = createTemporaryDirectory();
    const prepared = await createService(rootDirectory).prepare({
      sessionId: "session-1",
      command:
        "sqlmap -u 'https://example.com:8443/api/products' --method POST --data '{\"product\":{\"id\":1}}' -p id --level 1 --risk 1",
    });
    const rawRequest = readFileSync(prepared.secretFilePath, "utf8");

    expect(rawRequest).toContain("Content-Type: application/json");
    expect(rawRequest).toEndWith('\r\n\r\n{"product":{"id":1}}');
    expect(prepared.command).toContain("--ignore-redirects");

    prepared.cleanup();
  });

  test("isolates temporary requests between sessions and runs", async () => {
    const rootDirectory = createTemporaryDirectory();
    const first = await createService(rootDirectory, "session-1").prepare({
      sessionId: "session-1",
      command: "sqlmap -u 'https://example.com:8443/products?id=1' -p id",
    });
    const second = await createService(rootDirectory, "session-2").prepare({
      sessionId: "session-2",
      command: "sqlmap -u 'https://example.com:8443/products?id=2' -p id",
    });

    expect(first.secretFilePath).not.toBe(second.secretFilePath);
    expect(dirname(first.secretFilePath)).not.toBe(dirname(second.secretFilePath));
    first.cleanup();
    expect(existsSync(first.secretFilePath)).toBe(false);
    expect(existsSync(second.secretFilePath)).toBe(true);
    second.cleanup();
  });

  test("rejects missing, rejected, mismatched, and incompatible contexts", async () => {
    const rootDirectory = createTemporaryDirectory();
    const command = "sqlmap -u 'https://example.com:8443/products?id=1' -p id";

    await expect(
      createService(rootDirectory).prepare({ sessionId: "other-session", command }),
    ).rejects.toThrow("accepted Auth Check");
    await expect(
      new SqlmapAuthenticatedRunService({
        rootDirectory,
        contextService: {
          getAuthStateVersion: () => 0,
          loadProtectedContext: async () => null,
        },
        isProceedAllowed: () => true,
      }).prepare({ sessionId: "missing", command }),
    ).rejects.toThrow("saved authentication context");
    await expect(
      new SqlmapAuthenticatedRunService({
        rootDirectory,
        contextService: {
          getAuthStateVersion: () => 0,
          loadProtectedContext: async () => ({
            origin: "https://outside.example",
            cookies: "session=wrong-origin-secret",
            headers: "",
            updatedAt: "2026-08-01T10:00:00.000Z",
          }),
        },
        isProceedAllowed: () => true,
      }).prepare({ sessionId: "mismatch", command }),
    ).rejects.toThrow("exact origin");
    await expect(
      new SqlmapAuthenticatedRunService({
        rootDirectory,
        contextService: {
          getAuthStateVersion: () => 0,
          loadProtectedContext: async () => ({
            origin: "https://example.com:8443",
            cookies: "",
            headers: "Host: attacker.example",
            updatedAt: "2026-08-01T10:00:00.000Z",
          }),
        },
        isProceedAllowed: () => true,
      }).prepare({ sessionId: "incompatible", command }),
    ).rejects.toThrow("not compatible");
    await expect(
      new SqlmapAuthenticatedRunService({
        rootDirectory,
        contextService: {
          getAuthStateVersion: () => 0,
          loadProtectedContext: async () => ({
            origin: "https://example.com:8443",
            cookies: "",
            headers: "",
            updatedAt: "2026-08-01T10:00:00.000Z",
          }),
        },
        isProceedAllowed: () => true,
      }).prepare({ sessionId: "empty", command }),
    ).rejects.toThrow("compatible HTTP cookies or headers");
  });

  test("rejects context replacement during preparation", async () => {
    const rootDirectory = createTemporaryDirectory();
    let version = 0;
    const service = new SqlmapAuthenticatedRunService({
      rootDirectory,
      contextService: {
        getAuthStateVersion: () => version,
        loadProtectedContext: async () => {
          version += 1;
          return {
            origin: "https://example.com:8443",
            cookies: "session=replaced-secret",
            headers: "",
            updatedAt: "2026-08-01T10:00:00.000Z",
          };
        },
      },
      isProceedAllowed: () => true,
    });

    await expect(
      service.prepare({
        sessionId: "session-race",
        command: "sqlmap -u 'https://example.com:8443/products?id=1' -p id",
      }),
    ).rejects.toThrow("changed or expired");
    expect(Array.from(new Bun.Glob("**/*").scanSync(rootDirectory))).toEqual([]);
  });

  test("removes partial secret state and redacts setup failures", async () => {
    const rootDirectory = createTemporaryDirectory();
    const service = new SqlmapAuthenticatedRunService({
      rootDirectory,
      contextService: {
        getAuthStateVersion: () => 0,
        loadProtectedContext: async () => ({
          origin: "https://example.com:8443",
          cookies: "session=setup-secret-cookie",
          headers: "Authorization: Bearer setup-secret-token",
          updatedAt: "2026-08-01T10:00:00.000Z",
        }),
      },
      isProceedAllowed: () => true,
      writeSecretFile: (path, content) => {
        writeFileSync(path, content, { mode: 0o600 });
        throw new Error(`write failed: ${content}`);
      },
    });

    let message = "";
    try {
      await service.prepare({
        sessionId: "session-1",
        command: "sqlmap -u 'https://example.com:8443/products?id=1' -p id",
      });
    } catch (error) {
      message = error instanceof Error ? error.message : String(error);
    }

    expect(message).toContain("[redacted]");
    expect(message).not.toContain("setup-secret-cookie");
    expect(message).not.toContain("setup-secret-token");
    expect(Array.from(new Bun.Glob("**/*").scanSync(rootDirectory))).toEqual([]);
  });
});
