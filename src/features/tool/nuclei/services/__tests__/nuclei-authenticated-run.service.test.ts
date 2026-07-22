import { afterEach, describe, expect, it } from "bun:test";
import { existsSync, mkdtempSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { buildNucleiSecretFile } from "../nuclei-authenticated-run.helpers";
import { NucleiAuthenticatedRunService } from "../nuclei-authenticated-run.service";

const temporaryDirectories: string[] = [];

function createTemporaryDirectory() {
  const directory = mkdtempSync(join(tmpdir(), "nulltrace-nuclei-auth-test-"));
  temporaryDirectories.push(directory);
  return directory;
}

afterEach(() => {
  for (const directory of temporaryDirectories.splice(0)) {
    rmSync(directory, { recursive: true, force: true });
  }
});

describe("buildNucleiSecretFile", () => {
  it("scopes cookies and headers to the exact authenticated origin", () => {
    expect(
      buildNucleiSecretFile({
        origin: "https://example.com:8443",
        cookies: "session=abc; preference=compact",
        headers: "Authorization: Bearer secret\nX-Tenant: tenant-1",
        updatedAt: "2026-05-10T10:00:00.000Z",
      }),
    ).toBe(`# nulltrace-exact-origin: "https://example.com:8443"
static:
  - type: header
    domains-regex:
      - "^example\\\\.com:8443$"
    headers:
      - key: "Cookie"
        value: "session=abc; preference=compact"
      - key: "Authorization"
        value: "Bearer secret"
      - key: "X-Tenant"
        value: "tenant-1"
`);
  });
});

describe("NucleiAuthenticatedRunService", () => {
  it("creates an owner-restricted Secret File and removes it on cleanup", async () => {
    const rootDirectory = createTemporaryDirectory();
    const service = new NucleiAuthenticatedRunService({
      rootDirectory,
      contextService: {
        loadProtectedContext: async () => ({
          origin: "https://example.com",
          cookies: "session=secret-cookie",
          headers: "Authorization: Bearer secret-token",
          updatedAt: "2026-05-10T10:00:00.000Z",
        }),
      },
      isProceedAllowed: () => true,
    });

    const prepared = await service.prepare({
      sessionId: "session-1",
      targetUrl: "https://example.com/path",
      command: "nuclei -u https://example.com/path",
    });
    const secretPath = prepared.secretFilePath;

    expect(prepared.command).toContain(` -exclude-tags default-login -sf '${secretPath}'`);
    expect(statSync(rootDirectory).mode & 0o777).toBe(0o700);
    expect(statSync(dirname(secretPath)).mode & 0o777).toBe(0o700);
    expect(statSync(secretPath).mode & 0o777).toBe(0o600);
    expect(readFileSync(secretPath, "utf8")).toContain("secret-token");
    expect(prepared.command).not.toContain("secret-token");
    expect(prepared.command).not.toContain("secret-cookie");

    prepared.cleanup();

    expect(existsSync(secretPath)).toBe(false);
  });

  it("removes partial Secret File state when setup fails", async () => {
    const rootDirectory = createTemporaryDirectory();
    const service = new NucleiAuthenticatedRunService({
      rootDirectory,
      contextService: {
        loadProtectedContext: async () => ({
          origin: "https://example.com",
          cookies: "session=secret-cookie",
          headers: "",
          updatedAt: "2026-05-10T10:00:00.000Z",
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
        targetUrl: "https://example.com",
        command: "nuclei -u https://example.com",
      }),
    ).rejects.toThrow("simulated setup failure");
    expect(Array.from(new Bun.Glob("**/*").scanSync(rootDirectory))).toEqual([]);
  });

  it("rejects a command target outside the authenticated exact origin", async () => {
    const rootDirectory = createTemporaryDirectory();
    const service = new NucleiAuthenticatedRunService({
      rootDirectory,
      contextService: {
        loadProtectedContext: async () => ({
          origin: "https://example.com",
          cookies: "session=secret-cookie",
          headers: "",
          updatedAt: "2026-05-10T10:00:00.000Z",
        }),
      },
      isProceedAllowed: () => true,
    });

    await expect(
      service.prepare({
        sessionId: "session-1",
        targetUrl: "https://api.example.com",
        command: "nuclei -u https://api.example.com",
      }),
    ).rejects.toThrow("exact origin");
    expect(Array.from(new Bun.Glob("**/*").scanSync(rootDirectory))).toEqual([]);
  });
});
