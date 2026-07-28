import { afterEach, describe, expect, test } from "bun:test";
import { existsSync, mkdtempSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import {
  createInitialFfufParameterDiscoveryToolData,
  createInitialFfufToolData,
  createInitialFfufValueFuzzingToolData,
} from "../ffuf-command.helpers";
import { FfufAuthenticatedRunService } from "../ffuf-authenticated-run.service";

const temporaryDirectories: string[] = [];

function createTemporaryDirectory() {
  const directory = mkdtempSync(join(tmpdir(), "nulltrace-ffuf-auth-test-"));
  temporaryDirectories.push(directory);
  return directory;
}

function createService(rootDirectory: string) {
  return new FfufAuthenticatedRunService({
    rootDirectory,
    contextService: {
      getAuthStateVersion: () => 0,
      loadProtectedContext: async () => ({
        origin: "https://example.com:8443",
        cookies: "session=secret-cookie; preference=compact",
        headers: "Authorization: Bearer secret-token\nX-Tenant: tenant-1",
        updatedAt: "2026-07-28T10:00:00.000Z",
      }),
    },
    isProceedAllowed: () => true,
  });
}

afterEach(() => {
  for (const directory of temporaryDirectories.splice(0)) {
    rmSync(directory, { recursive: true, force: true });
  }
});

describe("FfufAuthenticatedRunService", () => {
  test("translates Content Discovery authentication into an owner-only raw request", async () => {
    const rootDirectory = createTemporaryDirectory();
    const artifactOutputPath = join(rootDirectory, "content.json");
    const toolData = createInitialFfufToolData("https://example.com:8443");
    toolData.form.isAuthenticatedContextEnabled = true;
    const prepared = await createService(rootDirectory).prepare({
      sessionId: "session-1",
      targetUrl: "https://example.com:8443/FUZZ",
      command: "ffuf -u https://example.com:8443/FUZZ -w /tmp/words.txt",
      toolData,
      artifactOutputPath,
    });
    const rawRequest = readFileSync(prepared.secretFilePath, "utf8");

    expect(prepared.command).toContain(`-request '${prepared.secretFilePath}'`);
    expect(prepared.command).toContain("-request-proto https");
    expect(prepared.command).not.toContain("secret-cookie");
    expect(prepared.command).not.toContain("secret-token");
    expect(rawRequest).toContain("GET /FUZZ HTTP/1.1");
    expect(rawRequest).toContain("Host: example.com:8443");
    expect(rawRequest).toContain("Cookie: session=secret-cookie; preference=compact");
    expect(rawRequest).toContain("Authorization: Bearer secret-token");
    expect(statSync(rootDirectory).mode & 0o777).toBe(0o700);
    expect(statSync(dirname(prepared.secretFilePath)).mode & 0o777).toBe(0o700);
    expect(statSync(prepared.secretFilePath).mode & 0o777).toBe(0o600);
    expect(prepared.redactOutput(rawRequest)).not.toContain("secret-cookie");
    expect(prepared.redactArtifact(JSON.stringify({ reflected: "secret-token" }))).not.toContain(
      "secret-token",
    );
    const temporaryOutputPath = prepared.command.match(/-o '([^']+)'/)?.[1];
    expect(temporaryOutputPath).toBeTruthy();
    writeFileSync(
      temporaryOutputPath!,
      JSON.stringify({
        config: {
          headers: {
            Authorization: "Bearer secret-token",
            Cookie: "session=secret-cookie",
          },
        },
        results: [],
      }),
    );
    prepared.prepareArtifacts();
    expect(readFileSync(artifactOutputPath, "utf8")).not.toContain("secret-token");
    expect(readFileSync(artifactOutputPath, "utf8")).not.toContain("secret-cookie");
    expect(statSync(artifactOutputPath).mode & 0o777).toBe(0o600);

    prepared.cleanup();

    expect(existsSync(prepared.secretFilePath)).toBe(false);
  });

  test("keeps Parameter Discovery and Value Fuzzing request shapes", async () => {
    const rootDirectory = createTemporaryDirectory();
    const parameterData = createInitialFfufParameterDiscoveryToolData(
      "https://example.com:8443/search",
    );
    parameterData.form.isAuthenticatedContextEnabled = true;
    parameterData.form.requestLocation = "body";
    const parameterRun = await createService(rootDirectory).prepare({
      sessionId: "session-1",
      targetUrl: "https://example.com:8443/search",
      command:
        "ffuf -u https://example.com:8443/search -X POST -d 'FUZZ=nulltrace' -w /tmp/parameters.txt",
      toolData: parameterData,
      artifactOutputPath: join(rootDirectory, "parameter.json"),
    });
    const valueData = createInitialFfufValueFuzzingToolData(
      "https://example.com:8443/search?fixed=1",
    );
    valueData.form.isAuthenticatedContextEnabled = true;
    valueData.form.parameterName = "X-Test";
    valueData.form.requestLocation = "header";
    const valueRun = await createService(rootDirectory).prepare({
      sessionId: "session-1",
      targetUrl: "https://example.com:8443/search?fixed=1",
      command:
        "ffuf -u 'https://example.com:8443/search?fixed=1' -H 'X-Test: FUZZ' -w /tmp/payloads.txt",
      toolData: valueData,
      artifactOutputPath: join(rootDirectory, "value.json"),
    });

    expect(readFileSync(parameterRun.secretFilePath, "utf8")).toContain(
      "POST /search HTTP/1.1",
    );
    expect(readFileSync(parameterRun.secretFilePath, "utf8")).toEndWith(
      "\r\n\r\nFUZZ=nulltrace",
    );
    expect(readFileSync(valueRun.secretFilePath, "utf8")).toContain("X-Test: FUZZ");
    expect(readFileSync(valueRun.secretFilePath, "utf8")).toContain(
      "GET /search?fixed=1 HTTP/1.1",
    );

    parameterRun.cleanup();
    valueRun.cleanup();
  });

  test("rejects unavailable, mismatched, incompatible, and redirecting contexts", async () => {
    const rootDirectory = createTemporaryDirectory();
    const toolData = createInitialFfufToolData("https://example.com");
    toolData.form.isAuthenticatedContextEnabled = true;
    const command = "ffuf -u https://example.com/FUZZ -w /tmp/words.txt";

    await expect(
      new FfufAuthenticatedRunService({
        rootDirectory,
        contextService: {
          getAuthStateVersion: () => 0,
          loadProtectedContext: async () => null,
        },
        isProceedAllowed: () => true,
      }).prepare({
        sessionId: "missing",
        targetUrl: "https://example.com/FUZZ",
        command,
        toolData,
        artifactOutputPath: join(rootDirectory, "missing.json"),
      }),
    ).rejects.toThrow("saved authentication context");
    await expect(
      new FfufAuthenticatedRunService({
        rootDirectory,
        contextService: {
          getAuthStateVersion: () => 0,
          loadProtectedContext: async () => ({
            origin: "https://outside.example",
            cookies: "session=secret",
            headers: "",
            updatedAt: "2026-07-28T10:00:00.000Z",
          }),
        },
        isProceedAllowed: () => true,
      }).prepare({
        sessionId: "mismatch",
        targetUrl: "https://example.com/FUZZ",
        command,
        toolData,
        artifactOutputPath: join(rootDirectory, "mismatch.json"),
      }),
    ).rejects.toThrow("exact origin");
    await expect(
      new FfufAuthenticatedRunService({
        rootDirectory,
        contextService: {
          getAuthStateVersion: () => 0,
          loadProtectedContext: async () => ({
            origin: "https://example.com",
            cookies: "",
            headers: "Host: attacker.example",
            updatedAt: "2026-07-28T10:00:00.000Z",
          }),
        },
        isProceedAllowed: () => true,
      }).prepare({
        sessionId: "incompatible",
        targetUrl: "https://example.com/FUZZ",
        command,
        toolData,
        artifactOutputPath: join(rootDirectory, "incompatible.json"),
      }),
    ).rejects.toThrow("not compatible");
    await expect(
      new FfufAuthenticatedRunService({
        rootDirectory,
        contextService: {
          getAuthStateVersion: () => 0,
          loadProtectedContext: async () => ({
            origin: "https://example.com",
            cookies: "session=secret",
            headers: "",
            updatedAt: "2026-07-28T10:00:00.000Z",
          }),
        },
        isProceedAllowed: () => false,
      }).prepare({
        sessionId: "rejected",
        targetUrl: "https://example.com/FUZZ",
        command,
        toolData,
        artifactOutputPath: join(rootDirectory, "rejected.json"),
      }),
    ).rejects.toThrow("accepted Auth Check");
    await expect(
      new FfufAuthenticatedRunService({
        rootDirectory,
        contextService: {
          getAuthStateVersion: () => 0,
          loadProtectedContext: async () => ({
            origin: "https://example.com",
            cookies: "session=secret",
            headers: "",
            updatedAt: "2026-07-28T10:00:00.000Z",
          }),
        },
        isProceedAllowed: () => true,
      }).prepare({
        sessionId: "redirect",
        targetUrl: "https://example.com/FUZZ",
        command: `${command} -r`,
        toolData,
        artifactOutputPath: join(rootDirectory, "redirect.json"),
      }),
    ).rejects.toThrow("redirects");
  });

  test("removes partial raw request state after setup failure", async () => {
    const rootDirectory = createTemporaryDirectory();
    const toolData = createInitialFfufToolData("https://example.com:8443");
    toolData.form.isAuthenticatedContextEnabled = true;
    const service = new FfufAuthenticatedRunService({
      rootDirectory,
      contextService: {
        getAuthStateVersion: () => 0,
        loadProtectedContext: async () => ({
          origin: "https://example.com:8443",
          cookies: "session=secret-cookie",
          headers: "",
          updatedAt: "2026-07-28T10:00:00.000Z",
        }),
      },
      isProceedAllowed: () => true,
      writeSecretFile: (path, content) => {
        writeFileSync(path, content, { mode: 0o600 });
        throw new Error("simulated setup failure");
      },
    });

    await expect(
      service.prepare({
        sessionId: "session-1",
        targetUrl: "https://example.com:8443/FUZZ",
        command: "ffuf -u https://example.com:8443/FUZZ -w /tmp/words.txt",
        toolData,
        artifactOutputPath: join(rootDirectory, "setup.json"),
      }),
    ).rejects.toThrow("simulated setup failure");
    expect(Array.from(new Bun.Glob("**/*").scanSync(rootDirectory))).toEqual([]);
  });

  test("rejects context replacement during preparation", async () => {
    const rootDirectory = createTemporaryDirectory();
    const toolData = createInitialFfufToolData("https://example.com");
    toolData.form.isAuthenticatedContextEnabled = true;
    let version = 0;
    const service = new FfufAuthenticatedRunService({
      rootDirectory,
      contextService: {
        getAuthStateVersion: () => version,
        loadProtectedContext: async () => {
          version += 1;
          return {
            origin: "https://example.com",
            cookies: "session=replaced-secret",
            headers: "",
            updatedAt: "2026-07-28T10:00:00.000Z",
          };
        },
      },
      isProceedAllowed: () => true,
    });

    await expect(
      service.prepare({
        sessionId: "session-race",
        targetUrl: "https://example.com/FUZZ",
        command: "ffuf -u https://example.com/FUZZ -w /tmp/words.txt",
        toolData,
        artifactOutputPath: join(rootDirectory, "race.json"),
      }),
    ).rejects.toThrow("changed or expired");
    expect(Array.from(new Bun.Glob("**/*").scanSync(rootDirectory))).toEqual([]);
  });

  test("redacts protected values from setup errors", async () => {
    const rootDirectory = createTemporaryDirectory();
    const toolData = createInitialFfufToolData("https://example.com");
    toolData.form.isAuthenticatedContextEnabled = true;
    const service = new FfufAuthenticatedRunService({
      rootDirectory,
      contextService: {
        getAuthStateVersion: () => 0,
        loadProtectedContext: async () => ({
          origin: "https://example.com",
          cookies: "session=error-secret-cookie",
          headers: "Authorization: Bearer error-secret-token",
          updatedAt: "2026-07-28T10:00:00.000Z",
        }),
      },
      isProceedAllowed: () => true,
      writeSecretFile: (_path, content) => {
        throw new Error(`write failed: ${content}`);
      },
    });

    let message = "";
    try {
      await service.prepare({
        sessionId: "session-error",
        targetUrl: "https://example.com/FUZZ",
        command: "ffuf -u https://example.com/FUZZ -w /tmp/words.txt",
        toolData,
        artifactOutputPath: join(rootDirectory, "error.json"),
      });
    } catch (error) {
      message = error instanceof Error ? error.message : String(error);
    }

    expect(message).toContain("[redacted]");
    expect(message).not.toContain("error-secret-cookie");
    expect(message).not.toContain("error-secret-token");
    expect(Array.from(new Bun.Glob("**/*").scanSync(rootDirectory))).toEqual([]);
  });
});
