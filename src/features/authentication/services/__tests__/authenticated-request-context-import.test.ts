import { describe, expect, test } from "bun:test";
import {
  listHarAuthenticationRequests,
  parseCurlAuthenticationContext,
  parseHarAuthenticationContext,
  parseHarAuthenticationContextImport,
} from "../authenticated-request-context-import";
import { createRedactedAuthenticatedRequestContextPreview } from "../authenticated-request-context-redaction";

describe("curl authentication context import", () => {
  test("extracts cookies and supported headers without replaying method or body", () => {
    const context = parseCurlAuthenticationContext(
      "curl 'https://app.example.test/account' -X POST --data 'password=never-copy' " +
        "-b 'session=cookie-secret; csrf=cookie-csrf' " +
        "-H 'Authorization: Bearer header-secret' -H 'X-CSRF-Token: header-csrf'",
      "https://app.example.test/dashboard",
    );

    expect(context).toEqual({
      origin: "https://app.example.test",
      cookies: "session=cookie-secret; csrf=cookie-csrf",
      headers: "Authorization: Bearer header-secret | X-CSRF-Token: header-csrf",
    });
  });

  test("filters transport and browser-only headers while preserving custom headers", () => {
    const context = parseCurlAuthenticationContext(
      "curl --url 'https://app.example.test/private' " +
        "-H 'Host: app.example.test' -H 'Content-Length: 99' " +
        "-H 'Connection: keep-alive' -H 'Sec-Fetch-Site: same-origin' " +
        "-H 'Sec-CH-UA: browser-noise' -H 'Cookie: session=cookie-secret' " +
        "-H 'Authorization: Basic auth-secret' -H 'X-Tenant: operations'",
      "https://app.example.test",
    );

    expect(context).toEqual({
      origin: "https://app.example.test",
      cookies: "session=cookie-secret",
      headers: "Authorization: Basic auth-secret | X-Tenant: operations",
    });
  });

  test("supports attached curl options and ignores URL-shaped body values", () => {
    expect(
      parseCurlAuthenticationContext(
        "curl -XPOST -d 'https://other.example.test/body-only' " +
          "-b'session=attached-cookie' -H'Authorization: Bearer attached-secret' " +
          "--url='https://app.example.test/private'",
        "https://app.example.test",
      ),
    ).toEqual({
      origin: "https://app.example.test",
      cookies: "session=attached-cookie",
      headers: "Authorization: Bearer attached-secret",
    });
  });

  test("returns readable failures without echoing protected values", () => {
    const protectedValue = "secret-that-must-not-be-echoed";
    let message = "";

    try {
      parseCurlAuthenticationContext(
        `curl 'https://other.example.test' -H 'Authorization: Bearer ${protectedValue}'`,
        "https://app.example.test",
      );
    } catch (error) {
      message = error instanceof Error ? error.message : String(error);
    }

    expect(message).toContain("exact origin");
    expect(message).not.toContain(protectedValue);
    expect(() =>
      parseCurlAuthenticationContext(
        "curl 'https://app.example.test -H 'Authorization: hidden'",
        "https://app.example.test",
      ),
    ).toThrow("Could not parse the curl command");
    expect(() =>
      parseCurlAuthenticationContext(
        "wget https://app.example.test -H 'Authorization: hidden'",
        "https://app.example.test",
      ),
    ).toThrow("Unsupported curl input");
  });

  test("does not treat unrelated option values as the request URL", () => {
    expect(() =>
      parseCurlAuthenticationContext(
        "curl https://other.example.test -H 'Authorization: hidden' " +
          "--referer https://app.example.test/page",
        "https://app.example.test",
      ),
    ).toThrow("exact origin");
  });

  test("does not echo malformed URL values in parse failures", () => {
    const protectedValue = "malformed-secret-value";
    let message = "";

    try {
      parseCurlAuthenticationContext(
        `curl 'https://[${protectedValue}' -H 'Authorization: hidden'`,
        "https://app.example.test",
      );
    } catch (error) {
      message = error instanceof Error ? error.message : String(error);
    }

    expect(message).toContain("valid HTTP or HTTPS URL");
    expect(message).not.toContain(protectedValue);
  });

  test("rejects cookie-file arguments instead of importing their paths", () => {
    const protectedPath = "secret-cookie-jar.txt";

    for (const cookieOption of [
      `-b '${protectedPath}'`,
      `--cookie='${protectedPath}'`,
      `-b'${protectedPath}'`,
    ]) {
      let message = "";
      try {
        parseCurlAuthenticationContext(
          `curl 'https://app.example.test' ${cookieOption}`,
          "https://app.example.test",
        );
      } catch (error) {
        message = error instanceof Error ? error.message : String(error);
      }

      expect(message).toContain("Cookie file imports are unsupported");
      expect(message).not.toContain(protectedPath);
    }
  });
});

const harWithMixedOrigins = JSON.stringify({
  log: {
    entries: [
      {
        request: {
          method: "GET",
          url: "https://app.example.test/account?token=query-secret",
          headers: [
            { name: "Host", value: "app.example.test" },
            { name: "Content-Length", value: "12" },
            { name: "Sec-Fetch-Mode", value: "navigate" },
            { name: "Authorization", value: "Bearer har-secret" },
            { name: "X-CSRF-Token", value: "csrf-secret" },
          ],
          cookies: [
            { name: "session", value: "cookie-secret" },
            { name: "tenant", value: "operations" },
          ],
        },
      },
      {
        request: {
          method: "POST",
          url: "https://other.example.test/admin?secret=cross-origin-secret",
          headers: [{ name: "Authorization", value: "Bearer other-secret" }],
          cookies: [],
        },
      },
      {
        request: {
          method: "HEAD",
          url: "https://app.example.test/status",
          headers: [{ name: "X-Tenant", value: "operations" }],
          cookies: [],
        },
      },
    ],
  },
});

describe("HAR authentication context import", () => {
  test("lists only same-origin requests without exposing query values", () => {
    expect(
      listHarAuthenticationRequests(harWithMixedOrigins, "https://app.example.test/dashboard"),
    ).toEqual([
      { entryIndex: 0, method: "GET", path: "/account" },
      { entryIndex: 2, method: "HEAD", path: "/status" },
    ]);
  });

  test("imports filtered authentication material from the selected request", () => {
    const context = parseHarAuthenticationContext(
      harWithMixedOrigins,
      "https://app.example.test",
      0,
    );
    expect(context).toEqual({
      origin: "https://app.example.test",
      cookies: "session=cookie-secret; tenant=operations",
      headers: "Authorization: Bearer har-secret | X-CSRF-Token: csrf-secret",
    });
    const preview = createRedactedAuthenticatedRequestContextPreview(context);
    expect(preview.cookiePreview).toBe("2 cookies [redacted]");
    expect(preview.headerPreview).toEqual([
      "Authorization: [redacted]",
      "X-CSRF-Token: [redacted]",
    ]);
    expect(JSON.stringify(preview)).not.toContain("har-secret");
    expect(JSON.stringify(preview)).not.toContain("cookie-secret");
  });

  test("returns the selected same-origin request URL for verification", () => {
    expect(
      parseHarAuthenticationContextImport(harWithMixedOrigins, "https://app.example.test", 0)
        .verificationUrl,
    ).toBe("https://app.example.test/account?token=query-secret");
  });

  test("rejects cross-origin choices and malformed input without echoing secrets", () => {
    expect(() =>
      parseHarAuthenticationContext(harWithMixedOrigins, "https://app.example.test", 1),
    ).toThrow("exact origin");

    const protectedValue = "malformed-secret-value";
    let message = "";
    try {
      listHarAuthenticationRequests(
        `{\"log\": {\"entries\": [${protectedValue}]}`,
        "https://app.example.test",
      );
    } catch (error) {
      message = error instanceof Error ? error.message : String(error);
    }
    expect(message).toContain("Could not parse the HAR data");
    expect(message).not.toContain(protectedValue);
    expect(() =>
      listHarAuthenticationRequests(
        JSON.stringify({ log: { entries: [] } }),
        "https://app.example.test",
      ),
    ).toThrow("does not contain any requests");
    expect(() =>
      parseHarAuthenticationContext(
        JSON.stringify({
          log: {
            entries: [
              {
                request: {
                  method: "GET",
                  url: "https://app.example.test/public",
                  headers: [{ name: "Host", value: "app.example.test" }],
                  cookies: [],
                },
              },
            ],
          },
        }),
        "https://app.example.test",
        0,
      ),
    ).toThrow("does not contain supported authentication material");
  });
});
