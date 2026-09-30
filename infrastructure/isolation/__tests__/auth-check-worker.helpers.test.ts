import { describe, expect, test } from "bun:test";
import {
  getAuthCheckWorkerProxyUrl,
  runAuthCheckWorker,
} from "../auth-check-worker.helpers";
import { parseAuthCheckWorkerConfiguration, parseAuthCheckWorkerResult } from "../auth-check-worker-protocol.helpers";
import type { AuthCheckWorkerConfiguration, AuthCheckWorkerResult } from "../auth-check-worker.types";

function createConfiguration(targetOrigin: string): AuthCheckWorkerConfiguration {
  return {
    version: 1,
    operation: "auth-check",
    contextVersion: 7,
    targetOrigin,
    verificationUrl: `${targetOrigin}/check?private-query-marker=never-export`,
    authenticatedHeaders: ["cookie: private-cookie-marker=secret", "x-auth-token: private-header-marker"],
    requestTimeoutMs: 10_000,
    maximumResponseBytes: 128_000,
    maximumRedirectCount: 5,
    totalDeadlineMs: 10_000,
  };
}

describe("Auth Check isolated worker protocol", () => {
  test("cross-origin redirect is observed at A and never requests B", async () => {
    let destinationHits = 0;
    const destination = Bun.serve({
      hostname: "127.0.0.1",
      port: 0,
      fetch() {
        destinationHits += 1;
        return new Response("destination body must not escape");
      },
    });
    let originHits = 0;
    const origin = Bun.serve({
      hostname: "127.0.0.1",
      port: 0,
      fetch(request) {
        if (request.headers.has("cookie")) expect(request.headers.get("cookie")).toBe("private-cookie-marker=secret");
        originHits += 1;
        return new Response("hostile <title>private body marker</title>", {
          status: 302,
          headers: { location: `${destination.url}receive?token=redirect-marker`, "content-type": "text/html" },
        });
      },
    });
    try {
      const result = await runAuthCheckWorker(createConfiguration(origin.url.origin));
      expect(originHits).toBe(2);
      expect(destinationHits).toBe(0);
      expect(result.authenticated.hasCrossOriginRedirect).toBe(true);
      expect(result.status).toBe("failed");
      const serialized = JSON.stringify(result);
      for (const marker of [
        "private-cookie-marker", "private-header-marker", "private-query-marker", "private body marker", "redirect-marker",
      ]) {
        expect(serialized).not.toContain(marker);
      }
      expect(serialized).not.toContain("127.0.0.1");
      expect(serialized).not.toContain("contentFingerprint");
      expect(serialized).not.toContain("titleFingerprint");
      expect(parseAuthCheckWorkerResult(result)).toEqual(result);
      expect(() => parseAuthCheckWorkerResult({
        ...result,
        status: "verified",
        isProceedAllowed: true,
        authenticated: { ...result.authenticated, status: 500 },
      })).toThrow();
    } finally {
      origin.stop(true);
      destination.stop(true);
    }
  });

  test("parsing rejects out-of-origin verification URLs and transport headers", () => {
    const configuration = createConfiguration("https://example.test");
    expect(() => parseAuthCheckWorkerConfiguration({
      ...configuration,
      verificationUrl: "https://other.test/check",
    })).toThrow();
    expect(() => parseAuthCheckWorkerConfiguration({
      ...configuration,
      authenticatedHeaders: ["Host: other.test"],
    })).toThrow();
  });

  test("worker requires a broker proxy and validates bounded result frames", async () => {
    const proxy = "http://172.30.0.3:3128/";
    expect(getAuthCheckWorkerProxyUrl({ HTTP_PROXY: proxy, HTTPS_PROXY: proxy, ALL_PROXY: proxy, NO_PROXY: "" })).toBe(proxy);
    expect(() => getAuthCheckWorkerProxyUrl({ HTTP_PROXY: proxy, HTTPS_PROXY: proxy, ALL_PROXY: proxy, NO_PROXY: "*" })).toThrow();
    expect(() => parseAuthCheckWorkerResult({ version: 1, operation: "auth-check", secret: "not allowed" })).toThrow();

    const configuration = createConfiguration("http://target-a.test");
    configuration.totalDeadlineMs = 1_000;
    const startedAt = performance.now();
    await expect(runAuthCheckWorker(configuration, async () => new Response(new ReadableStream<Uint8Array>({
      start() {},
      cancel() {
        return new Promise(() => {});
      },
    }), { headers: { "content-type": "text/html" } }))).rejects.toThrow("Auth Check worker request failed.");
    expect(performance.now() - startedAt).toBeLessThan(2_000);

    const overflowConfiguration = createConfiguration("https://example.test");
    const overflowStartedAt = performance.now();
    await expect(runAuthCheckWorker(overflowConfiguration, async () => new Response(new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(new Uint8Array(128_001));
      },
      cancel() {
        return new Promise(() => {});
      },
    }), { headers: { "content-type": "text/html" } }))).rejects.toThrow("Auth Check worker request failed.");
    expect(performance.now() - overflowStartedAt).toBeLessThan(1_000);
  });

  test("result parser rejects impossible difference flags without exposing raw evidence", () => {
    const verifiedResult: AuthCheckWorkerResult = {
      version: 1,
      operation: "auth-check",
      status: "verified",
      isProceedAllowed: true,
      unauthenticated: {
        status: 401,
        redirectCount: 0,
        hasCrossOriginRedirect: false,
        contentKind: "html",
        hasLoginForm: true,
      },
      authenticated: {
        status: 200,
        redirectCount: 0,
        hasCrossOriginRedirect: false,
        contentKind: "html",
        hasLoginForm: false,
      },
      differences: {
        statusChanged: true,
        redirectsChanged: false,
        contentKindChanged: false,
        contentChanged: false,
        titleChanged: false,
        loginFormChanged: true,
      },
    };
    expect(parseAuthCheckWorkerResult(verifiedResult)).toEqual(verifiedResult);
    expect(() => parseAuthCheckWorkerResult({
      ...verifiedResult,
      differences: { ...verifiedResult.differences, redirectsChanged: true },
    })).toThrow();
    expect(() => parseAuthCheckWorkerResult({
      ...verifiedResult,
      unauthenticated: { ...verifiedResult.unauthenticated, contentKind: "json", hasLoginForm: false },
      authenticated: { ...verifiedResult.authenticated, contentKind: "json" },
      differences: { ...verifiedResult.differences, contentKindChanged: true, titleChanged: true },
    })).toThrow();
    expect(() => parseAuthCheckWorkerResult({
      ...verifiedResult,
      status: "failed",
      isProceedAllowed: false,
      authenticated: { ...verifiedResult.authenticated, hasCrossOriginRedirect: true },
    })).toThrow();
  });

  test("HTML signals retain Cheerio handling of comments, scripts, entities, and malformed forms", async () => {
    const configuration = createConfiguration("https://example.test");
    const result = await runAuthCheckWorker(configuration, async (_input, init) => {
      const isAuthenticated = new Headers(init?.headers).has("cookie");
      const body = isAuthenticated
        ? "<title>A &#38; B</title><form><input type=pass&#119;ord>"
        : "<title>A &amp; B</title><!-- <form><input type=password></form> --><script><form><input type=password></form></script>";
      return new Response(body, { headers: { "content-type": "text/html" } });
    });
    expect(result.unauthenticated.hasLoginForm).toBe(false);
    expect(result.authenticated.hasLoginForm).toBe(true);
    expect(result.differences.titleChanged).toBe(false);
    expect(result.status).toBe("failed");
  });

  test("same-origin redirects keep authentication on both legs and return to the approved origin", async () => {
    const seenCookies: boolean[] = [];
    const origin = Bun.serve({
      hostname: "127.0.0.1",
      port: 0,
      fetch(request) {
        const url = new URL(request.url);
        const hasCookie = request.headers.has("cookie");
        seenCookies.push(hasCookie);
        if (url.pathname === "/check") return new Response(null, { status: 302, headers: { location: "/final" } });
        return new Response(hasCookie ? "<title>Member</title>" : "<title>Sign in</title>", {
          status: hasCookie ? 200 : 401,
          headers: { "content-type": "text/html" },
        });
      },
    });
    try {
      const result = await runAuthCheckWorker(createConfiguration(origin.url.origin));
      expect(seenCookies).toEqual([false, false, true, true]);
      expect(result.status).toBe("verified");
      expect(result.unauthenticated.redirectCount).toBe(1);
      expect(result.authenticated.redirectCount).toBe(1);
      expect(result.authenticated.hasCrossOriginRedirect).toBe(false);
      expect(JSON.stringify(result)).not.toContain("127.0.0.1");
    } finally {
      origin.stop(true);
    }
  });
});
