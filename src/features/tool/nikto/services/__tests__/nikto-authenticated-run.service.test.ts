import { afterEach, describe, expect, test } from "bun:test";
import {
  existsSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { buildNiktoAuthenticationConfig } from "../nikto-authenticated-run.helpers";
import { NiktoAuthenticatedRunService } from "../nikto-authenticated-run.service";

const temporaryDirectories: string[] = [];

function createTemporaryDirectory() {
  const directory = mkdtempSync(join(tmpdir(), "nulltrace-nikto-auth-test-"));
  temporaryDirectories.push(directory);
  return directory;
}

afterEach(() => {
  for (const directory of temporaryDirectories.splice(0)) {
    rmSync(directory, { recursive: true, force: true });
  }
});

describe("buildNiktoAuthenticationConfig", () => {
  test("translates cookies, Basic authorization, and compatible headers", () => {
    expect(
      buildNiktoAuthenticationConfig({
        origin: "https://example.com:8443",
        cookies: "session=secret-cookie; preference=compact",
        headers:
          "Authorization: Basic dXNlcjpwYXNzd29yZA==\nX-Api-Key: secret-key",
        updatedAt: "2026-07-31T10:00:00.000Z",
      }),
    ).toBe(`CHECKMETHODS=GET
@@DEFAULT=@@ALL
STATIC-COOKIE="session=secret-cookie";"preference=compact"
CLIOPTS=-id=user:password -Add-header=X-Api-Key:secret-key
`);
  });

  test("overrides base config cookies and command options", () => {
    const config = buildNiktoAuthenticationConfig(
      {
        origin: "https://example.com",
        cookies: "selected=secret-cookie",
        headers: "",
        updatedAt: "2026-07-31T10:00:00.000Z",
      },
      "EXECDIR=/opt/nikto\nSTATIC-COOKIE=unrelated=secret\nCLIOPTS=-id=other:secret\nPROXYUSER=other\nPROXYPASS=proxy-secret\n",
    );

    expect(config).not.toContain("unrelated=secret");
    expect(config).not.toContain("other:secret");
    expect(config).not.toContain("proxy-secret");
    expect(config).toEndWith(
      '@@DEFAULT=@@ALL\nSTATIC-COOKIE="selected=secret-cookie"\nCLIOPTS=\n',
    );
  });

  test("preserves the installed Nikto default plugin exclusions", () => {
    const config = buildNiktoAuthenticationConfig(
      {
        origin: "https://example.com",
        cookies: "session=secret-cookie",
        headers: "",
        updatedAt: "2026-07-31T10:00:00.000Z",
      },
      "EXECDIR=/opt/nikto\n@@DEFAULT=@@ALL;-@@EXTRAS;tests(report:500)",
    );

    expect(config.match(/^@@DEFAULT=/gm)).toHaveLength(1);
    expect(config).toContain("@@DEFAULT=@@ALL;-@@EXTRAS;tests(report:500)");
  });

  test("rejects authentication material Nikto cannot encode safely in its config", () => {
    expect(() =>
      buildNiktoAuthenticationConfig({
        origin: "https://example.com",
        cookies: "",
        headers: "Authorization: Bearer secret-token",
        updatedAt: "2026-07-31T10:00:00.000Z",
      }),
    ).toThrow("not compatible with authenticated Nikto");
    expect(() =>
      buildNiktoAuthenticationConfig({
        origin: "https://example.com",
        cookies: "session=value#truncated",
        headers: "",
        updatedAt: "2026-07-31T10:00:00.000Z",
      }),
    ).toThrow("not compatible with authenticated Nikto");
  });
});

describe("NiktoAuthenticatedRunService", () => {
  test("creates owner-only per-run config and redacts copied report", async () => {
    const rootDirectory = createTemporaryDirectory();
    const artifactOutputPath = join(rootDirectory, "artifacts", "nikto.json");
    const service = new NiktoAuthenticatedRunService({
      rootDirectory,
      loadBaseConfig: () => "EXECDIR=/opt/nikto",
      contextService: {
        getAuthStateVersion: () => 0,
        loadProtectedContext: async () => ({
          origin: "https://example.com",
          cookies: "session=secret-cookie",
          headers: "X-Api-Key: secret-token",
          updatedAt: "2026-07-31T10:00:00.000Z",
        }),
      },
      isProceedAllowed: () => true,
    });

    const prepared = await service.prepare({
      sessionId: "session-1",
      targetUrl: "https://example.com/protected",
      command:
        "nikto -h 'https://example.com/protected' -Tuning 'x6' -Format json -output '/persisted/nikto'",
      artifactOutputPath,
    });
    const config = readFileSync(prepared.secretFilePath, "utf8");

    expect(prepared.command).toContain(`-config '${prepared.secretFilePath}'`);
    expect(prepared.command).not.toContain("secret-cookie");
    expect(prepared.command).not.toContain("secret-token");
    expect(prepared.command).not.toContain("/persisted/nikto");
    expect(config).toContain('STATIC-COOKIE="session=secret-cookie"');
    expect(config).toContain("-Add-header=X-Api-Key:secret-token");
    expect(statSync(rootDirectory).mode & 0o777).toBe(0o700);
    expect(statSync(dirname(prepared.secretFilePath)).mode & 0o777).toBe(0o700);
    expect(statSync(prepared.secretFilePath).mode & 0o777).toBe(0o600);

    const temporaryOutputPrefix = prepared.command.match(/-output '([^']+)'/)?.[1];
    expect(temporaryOutputPrefix).toBeTruthy();
    writeFileSync(
      `${temporaryOutputPrefix}.json`,
      JSON.stringify({
        vulnerabilities: [
          {
            id: "1",
            url: "/reflected/secret-token",
            message: "cookie secret-cookie",
          },
        ],
      }),
    );
    prepared.prepareArtifacts();

    const artifact = readFileSync(artifactOutputPath, "utf8");
    expect(artifact).not.toContain("secret-cookie");
    expect(artifact).not.toContain("secret-token");
    expect(artifact).toContain("[redacted]");
    expect(statSync(artifactOutputPath).mode & 0o777).toBe(0o600);

    prepared.cleanup();
    expect(existsSync(prepared.secretFilePath)).toBe(false);
  });

  test("rejects missing, rejected, changed, and wrong-origin contexts", async () => {
    const rootDirectory = createTemporaryDirectory();
    const input = {
      sessionId: "session-1",
      targetUrl: "https://example.com",
      command: "nikto -h https://example.com -Tuning x6",
      artifactOutputPath: join(rootDirectory, "nikto.json"),
    };

    await expect(
      new NiktoAuthenticatedRunService({
        rootDirectory,
        loadBaseConfig: () => "EXECDIR=/opt/nikto",
        contextService: {
          getAuthStateVersion: () => 0,
          loadProtectedContext: async () => null,
        },
        isProceedAllowed: () => true,
      }).prepare(input),
    ).rejects.toThrow("saved authentication context");
    await expect(
      new NiktoAuthenticatedRunService({
        rootDirectory,
        loadBaseConfig: () => "EXECDIR=/opt/nikto",
        contextService: {
          getAuthStateVersion: () => 0,
          loadProtectedContext: async () => ({
            origin: "https://example.com",
            cookies: "session=secret",
            headers: "",
            updatedAt: "2026-07-31T10:00:00.000Z",
          }),
        },
        isProceedAllowed: () => false,
      }).prepare(input),
    ).rejects.toThrow("accepted Auth Check");
    await expect(
      new NiktoAuthenticatedRunService({
        rootDirectory,
        loadBaseConfig: () => "EXECDIR=/opt/nikto",
        contextService: {
          getAuthStateVersion: () => 0,
          loadProtectedContext: async () => ({
            origin: "https://other.example",
            cookies: "session=secret",
            headers: "",
            updatedAt: "2026-07-31T10:00:00.000Z",
          }),
        },
        isProceedAllowed: () => true,
      }).prepare(input),
    ).rejects.toThrow("exact origin");

    let version = 0;
    await expect(
      new NiktoAuthenticatedRunService({
        rootDirectory,
        loadBaseConfig: () => "EXECDIR=/opt/nikto",
        contextService: {
          getAuthStateVersion: () => version,
          loadProtectedContext: async () => {
            version += 1;
            return {
              origin: "https://example.com",
              cookies: "session=secret",
              headers: "",
              updatedAt: "2026-07-31T10:00:00.000Z",
            };
          },
        },
        isProceedAllowed: () => true,
      }).prepare(input),
    ).rejects.toThrow("changed or expired");
    expect(Array.from(new Bun.Glob("**/*").scanSync(rootDirectory))).toEqual([]);
  });

  test("cleans partial secret state and redacts setup errors", async () => {
    const rootDirectory = createTemporaryDirectory();
    const service = new NiktoAuthenticatedRunService({
      rootDirectory,
      loadBaseConfig: () => "EXECDIR=/opt/nikto",
      contextService: {
        getAuthStateVersion: () => 0,
        loadProtectedContext: async () => ({
          origin: "https://example.com",
          cookies: "session=error-secret",
          headers: "Authorization: Basic dXNlcjpwYXNzd29yZA==",
          updatedAt: "2026-07-31T10:00:00.000Z",
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
        targetUrl: "https://example.com",
        command: "nikto -h https://example.com -Tuning x6",
        artifactOutputPath: join(rootDirectory, "nikto.json"),
      });
    } catch (error) {
      message = error instanceof Error ? error.message : String(error);
    }

    expect(message).toContain("[redacted]");
    expect(message).not.toContain("error-secret");
    expect(message).not.toContain("user:password");
    expect(Array.from(new Bun.Glob("**/*").scanSync(rootDirectory))).toEqual([]);
  });

  test("loads context by session and creates isolated per-run secret files", async () => {
    const rootDirectory = createTemporaryDirectory();
    const loadedSessionIds: string[] = [];
    const service = new NiktoAuthenticatedRunService({
      rootDirectory,
      loadBaseConfig: () => "EXECDIR=/opt/nikto",
      contextService: {
        getAuthStateVersion: () => 0,
        loadProtectedContext: async (sessionId) => {
          loadedSessionIds.push(sessionId);
          return {
            origin: "https://example.com",
            cookies: `session=${sessionId}-secret`,
            headers: "",
            updatedAt: "2026-07-31T10:00:00.000Z",
          };
        },
      },
      isProceedAllowed: () => true,
    });
    const baseInput = {
      targetUrl: "https://example.com",
      command: "nikto -h https://example.com -Tuning x6",
    };

    const first = await service.prepare({
      ...baseInput,
      sessionId: "session-1",
      artifactOutputPath: join(rootDirectory, "session-1.json"),
    });
    const second = await service.prepare({
      ...baseInput,
      sessionId: "session-2",
      artifactOutputPath: join(rootDirectory, "session-2.json"),
    });

    expect(loadedSessionIds).toEqual(["session-1", "session-2"]);
    expect(first.secretFilePath).not.toBe(second.secretFilePath);
    expect(readFileSync(first.secretFilePath, "utf8")).toContain("session-1-secret");
    expect(readFileSync(first.secretFilePath, "utf8")).not.toContain("session-2-secret");
    expect(readFileSync(second.secretFilePath, "utf8")).toContain("session-2-secret");
    expect(readFileSync(second.secretFilePath, "utf8")).not.toContain("session-1-secret");

    first.cleanup();
    second.cleanup();
  });
});
