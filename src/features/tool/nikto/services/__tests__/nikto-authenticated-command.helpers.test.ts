import { describe, expect, test } from "bun:test";
import {
  redactNiktoCommandForPersistence,
  validateAuthenticatedNiktoCommand,
} from "../nikto-authenticated-command.helpers";

describe("authenticated Nikto command validation", () => {
  test("returns one explicit credential-free HTTP target", () => {
    expect(
      validateAuthenticatedNiktoCommand(
        "nikto -h 'https://example.com:8443/protected' -Tuning x6",
      ),
    ).toBe("https://example.com:8443/protected");
  });

  test("rejects redirects, multiple targets, credentials, and secret-bearing options", () => {
    for (const command of [
      "nikto -h https://example.com -followredirects -Tuning x6",
      "nikto -h https://example.com -h https://other.example -Tuning x6",
      "nikto -h https://user:password@example.com -Tuning x6",
      "nikto -h https://example.com -id user:password -Tuning x6",
      "nikto -h https://example.com -Add-header 'Authorization: Bearer token' -Tuning x6",
      "nikto -h https://example.com -config /tmp/secret.conf -Tuning x6",
      "nikto -h https://example.com -Option STATIC-COOKIE=session=secret -Tuning x6",
      "nikto -h https://example.com -vhost other.example -Tuning x6",
    ]) {
      expect(() => validateAuthenticatedNiktoCommand(command)).toThrow();
    }
  });

  test("rejects authenticated response saving and accepted abbreviations", () => {
    for (const option of ["-Save", "-Sav", "-Sa"]) {
      expect(() =>
        validateAuthenticatedNiktoCommand(
          `nikto -h https://example.com ${option} /tmp/responses -Tuning x6`,
        ),
      ).toThrow();
    }
  });

  test("validates abbreviated vhost options against the target authority", () => {
    expect(() =>
      validateAuthenticatedNiktoCommand(
        "nikto -h https://example.com -vho attacker.example -Tuning x6",
      ),
    ).toThrow("exact authority");
    expect(
      validateAuthenticatedNiktoCommand(
        "nikto -h https://example.com -vho example.com -Tuning x6",
      ),
    ).toBe("https://example.com");
  });
});

describe("Nikto command persistence redaction", () => {
  test("redacts authorization values and URL user info", () => {
    const redacted = redactNiktoCommandForPersistence(
      "nikto -h https://user:password@example.com -id admin:secret " +
        "-Add-header 'Authorization: Bearer token-value' -Tuning x6",
    );

    expect(redacted).not.toContain("password");
    expect(redacted).not.toContain("admin:secret");
    expect(redacted).not.toContain("token-value");
    expect(redacted).toContain("[redacted]");
  });

  test("redacts abbreviated and configuration-based secret inputs", () => {
    const redacted = redactNiktoCommandForPersistence(
      "nikto -h https://example.com -add 'X-Api-Key: secret' " +
        "-opt STATIC-COOKIE=session=secret-cookie -con /tmp/private.conf",
    );

    expect(redacted).not.toContain("X-Api-Key: secret");
    expect(redacted).not.toContain("session=secret-cookie");
    expect(redacted).not.toContain("/tmp/private.conf");
  });

  test("redacts parser-equivalent quoted and concatenated authentication options", () => {
    for (const command of [
      "nikto -h https://example.com '-id' 'admin:secret' -Tuning x6",
      "nikto -h https://example.com -i''d admin:secret -Tuning x6",
      "nikto -h https://example.com '-Add-header' 'Authorization: Bearer secret-token' -Tuning x6",
    ]) {
      const redacted = redactNiktoCommandForPersistence(command);

      expect(redacted).toContain("[redacted]");
      expect(redacted).not.toContain("admin:secret");
      expect(redacted).not.toContain("secret-token");
    }
  });

  test("redacts entire malformed commands after a direct authentication option", () => {
    for (const command of [
      "nikto -h https://example.com -Add-header Authorization: Bearer secret-token -Tuning x6",
      "nikto -h https://example.com -id admin secret-password -Tuning x6",
    ]) {
      const redacted = redactNiktoCommandForPersistence(command);

      expect(redacted).toBe(
        "[redacted] prohibited Nikto authentication/configuration command",
      );
      expect(redacted).not.toContain("secret-token");
      expect(redacted).not.toContain("secret-password");
    }
  });
});
