import { describe, expect, test } from "bun:test";
import { PageInspectionSnapshot } from "../../model/page-inspection.types";
import { PageInspectionPermissionService } from "../page-inspection-permission.service";
import { PageInspectionService } from "../page-inspection.service";

const snapshot: PageInspectionSnapshot = {
  requestedUrl: "https://target.example/page",
  finalUrl: "https://target.example/page",
  status: 200,
  contentType: "text/html",
  title: "Rendered page",
  visibleText: "Client rendered content",
  forms: [],
  links: [],
  scripts: [],
  domOutline: [],
  metadata: [],
  securitySignals: {
    contentSecurityPolicy: null,
    frameOptions: null,
    referrerPolicy: null,
    permissionsPolicy: null,
    hasPasswordFields: false,
  },
  isPartial: false,
  truncatedSections: [],
};

class FakePageInspectionBrowser {
  calls: Array<{
    requestedUrl: string;
    targetOrigin: string;
    authentication?: { origin: string; cookies: string; headers: string };
  }> = [];

  async inspect(
    input: { requestedUrl: string; targetOrigin: string },
    _limits: unknown,
  ) {
    this.calls.push(input);
    return snapshot;
  }
}

describe("PageInspectionService", () => {
  test("requires a current session grant before inspecting", async () => {
    const browser = new FakePageInspectionBrowser();
    const service = new PageInspectionService(
      new PageInspectionPermissionService({ isChromiumAvailable: () => true }),
      browser,
    );

    await expect(
      service.inspect({
        sessionId: "session-one",
        requestedUrl: "https://target.example/page",
        targetOrigin: "https://target.example",
      }),
    ).rejects.toThrow("Page Inspection is blocked for this testing session.");
    expect(browser.calls).toEqual([]);
  });

  test("allows an exact-origin page after a grant", async () => {
    const browser = new FakePageInspectionBrowser();
    const permissions = new PageInspectionPermissionService({ isChromiumAvailable: () => true });
    permissions.allowPublic("session-one");
    const service = new PageInspectionService(permissions, browser);

    await expect(
      service.inspect({
        sessionId: "session-one",
        requestedUrl: "https://target.example/page",
        targetOrigin: "https://target.example",
      }),
    ).resolves.toMatchObject({ title: "Rendered page" });
    expect(browser.calls).toEqual([
      {
        requestedUrl: "https://target.example/page",
        targetOrigin: "https://target.example",
      },
    ]);
  });

  test("uses public mode without loading authentication", async () => {
    const browser = new FakePageInspectionBrowser();
    const permissions = new PageInspectionPermissionService({ isChromiumAvailable: () => true });
    permissions.allowPublic("session-one");
    let contextLoads = 0;
    const service = new PageInspectionService(
      permissions,
      browser,
      {
        loadProtectedContext: async () => {
          contextLoads += 1;
          return null;
        },
      },
      { isProceedAllowed: () => true },
    );

    await service.inspect({
      sessionId: "session-one",
      requestedUrl: "https://target.example/public",
      targetOrigin: "https://target.example",
    });

    expect(browser.calls).toEqual([
      {
        requestedUrl: "https://target.example/public",
        targetOrigin: "https://target.example",
      },
    ]);
    expect(contextLoads).toBe(0);
  });

  test("uses one accepted context for every inspection in authenticated session mode", async () => {
    const browser = new FakePageInspectionBrowser();
    const permissions = new PageInspectionPermissionService({ isChromiumAvailable: () => true });
    permissions.allowAuthenticated("session-one");
    const service = new PageInspectionService(
      permissions,
      browser,
      {
        loadProtectedContext: async () => ({
          origin: "https://target.example",
          cookies: "session=secret-cookie",
          headers: "Authorization: Bearer secret-header",
          updatedAt: "2026-07-25T10:00:00.000Z",
        }),
      },
      { isProceedAllowed: () => true },
    );

    await service.inspect({
      sessionId: "session-one",
      requestedUrl: "https://target.example/private",
      targetOrigin: "https://target.example",
      protectedPaths: ["https://target.example/private"],
    });
    await service.inspect({
      sessionId: "session-one",
      requestedUrl: "https://target.example/private-two",
      targetOrigin: "https://target.example",
      protectedPaths: ["https://target.example/private"],
    });

    expect(browser.calls).toEqual([
      {
        requestedUrl: "https://target.example/private",
        targetOrigin: "https://target.example",
        authentication: {
          origin: "https://target.example",
          cookies: "session=secret-cookie",
          headers: "Authorization: Bearer secret-header",
        },
      },
      {
        requestedUrl: "https://target.example/private-two",
        targetOrigin: "https://target.example",
        authentication: {
          origin: "https://target.example",
          cookies: "session=secret-cookie",
          headers: "Authorization: Bearer secret-header",
        },
      },
    ]);
  });

  test("rejects rejected, missing, and incompatible authenticated contexts without public fallback", async () => {
    const rejectedBrowser = new FakePageInspectionBrowser();
    const permissions = new PageInspectionPermissionService({ isChromiumAvailable: () => true });
    permissions.allowAuthenticated("session-one");
    const rejectedService = new PageInspectionService(
      permissions,
      rejectedBrowser,
      { loadProtectedContext: async () => null },
      { isProceedAllowed: () => false },
    );
    await expect(
      rejectedService.inspect({
        sessionId: "session-one",
        requestedUrl: "https://target.example/private",
        targetOrigin: "https://target.example",
      }),
    ).rejects.toThrow("requires an accepted authentication context");
    expect(rejectedBrowser.calls).toEqual([]);

    const missingBrowser = new FakePageInspectionBrowser();
    const missingService = new PageInspectionService(
      permissions,
      missingBrowser,
      { loadProtectedContext: async () => null },
      { isProceedAllowed: () => true },
    );
    await expect(
      missingService.inspect({
        sessionId: "session-one",
        requestedUrl: "https://target.example/private",
        targetOrigin: "https://target.example",
      }),
    ).rejects.toThrow("unavailable");
    expect(missingBrowser.calls).toEqual([]);

    const incompatibleBrowser = new FakePageInspectionBrowser();
    const incompatibleService = new PageInspectionService(
      permissions,
      incompatibleBrowser,
      {
        loadProtectedContext: async () => ({
          origin: "https://other.example",
          cookies: "session=wrong-context",
          headers: "",
          updatedAt: "2026-07-25T10:00:00.000Z",
        }),
      },
      { isProceedAllowed: () => true },
    );
    await expect(
      incompatibleService.inspect({
        sessionId: "session-one",
        requestedUrl: "https://target.example/private",
        targetOrigin: "https://target.example",
      }),
    ).rejects.toThrow("exact origin");
    expect(incompatibleBrowser.calls).toEqual([]);
  });

  test("allows authenticated mode to finish on a protected page", async () => {
    const permissions = new PageInspectionPermissionService({ isChromiumAvailable: () => true });
    permissions.allowAuthenticated("session-one");
    const service = new PageInspectionService(
      permissions,
      {
        inspect: async () => ({
          ...snapshot,
          requestedUrl: "https://target.example/private",
          finalUrl: "https://target.example/private",
        }),
      },
      {
        loadProtectedContext: async () => ({
          origin: "https://target.example",
          cookies: "session=selected-context",
          headers: "",
          updatedAt: "2026-07-25T10:00:00.000Z",
        }),
      },
      { isProceedAllowed: () => true },
    );

    await expect(
      service.inspect({
        sessionId: "session-one",
        requestedUrl: "https://target.example/private",
        targetOrigin: "https://target.example",
        protectedPaths: ["https://target.example/private"],
      }),
    ).resolves.toMatchObject({ finalUrl: "https://target.example/private" });
  });

  test("reports a rejected authenticated context without falling back to public inspection", async () => {
    const permissions = new PageInspectionPermissionService({ isChromiumAvailable: () => true });
    permissions.allowAuthenticated("session-one");
    const service = new PageInspectionService(
      permissions,
      {
        inspect: async () => ({
          ...snapshot,
          finalUrl: "https://target.example/login.php",
          status: 200,
        }),
      },
      {
        loadProtectedContext: async () => ({
          origin: "https://target.example",
          cookies: "session=expired-context",
          headers: "",
          updatedAt: "2026-07-25T10:00:00.000Z",
        }),
      },
      { isProceedAllowed: () => true },
    );

    await expect(
      service.inspect({
        sessionId: "session-one",
        requestedUrl: "https://target.example/private",
        targetOrigin: "https://target.example",
      }),
    ).rejects.toThrow("rejected by the target");
  });

  test("rejects cross-origin requests before browser navigation", async () => {
    const browser = new FakePageInspectionBrowser();
    const permissions = new PageInspectionPermissionService({ isChromiumAvailable: () => true });
    permissions.allowPublic("session-one");
    const service = new PageInspectionService(permissions, browser);

    await expect(
      service.inspect({
        sessionId: "session-one",
        requestedUrl: "https://outside.example/page",
        targetOrigin: "https://target.example",
      }),
    ).rejects.toThrow("Page Inspection only allows the exact target origin.");
    expect(browser.calls).toEqual([]);
  });

  test("reports a Chromium installation action without calling the browser", async () => {
    const browser = new FakePageInspectionBrowser();
    const permissions = new PageInspectionPermissionService({ isChromiumAvailable: () => false });
    permissions.allowPublic("session-one");
    const service = new PageInspectionService(permissions, browser);

    await expect(
      service.inspect({
        sessionId: "session-one",
        requestedUrl: "https://target.example/page",
        targetOrigin: "https://target.example",
      }),
    ).rejects.toThrow("bunx playwright install chromium");
    expect(browser.calls).toEqual([]);
  });

  test("rejects an out-of-origin final URL from the browser", async () => {
    const permissions = new PageInspectionPermissionService({ isChromiumAvailable: () => true });
    permissions.allowPublic("session-one");
    const service = new PageInspectionService(permissions, {
      inspect: async () => ({
        ...snapshot,
        finalUrl: "https://outside.example/redirected",
      }),
    });

    await expect(
      service.inspect({
        sessionId: "session-one",
        requestedUrl: "https://target.example/page",
        targetOrigin: "https://target.example",
      }),
    ).rejects.toThrow("out-of-origin redirect");
  });

  test("rejects a redirect that lands on a known protected path", async () => {
    const permissions = new PageInspectionPermissionService({ isChromiumAvailable: () => true });
    permissions.allowPublic("session-one");
    const service = new PageInspectionService(permissions, {
      inspect: async () => ({
        ...snapshot,
        finalUrl: "https://target.example/admin",
      }),
    });

    await expect(
      service.inspect({
        sessionId: "session-one",
        requestedUrl: "https://target.example/public",
        targetOrigin: "https://target.example",
        protectedPaths: ["https://target.example/admin"],
      }),
    ).rejects.toThrow("known protected paths");
  });

  test("does not navigate to known protected paths", async () => {
    const browser = new FakePageInspectionBrowser();
    const permissions = new PageInspectionPermissionService({ isChromiumAvailable: () => true });
    permissions.allowPublic("session-one");
    const service = new PageInspectionService(permissions, browser);

    await expect(
      service.inspect({
        sessionId: "session-one",
        requestedUrl: "https://target.example/admin/users",
        targetOrigin: "https://target.example",
        protectedPaths: ["https://target.example/admin"],
      }),
    ).rejects.toThrow("known protected paths");
    expect(browser.calls).toEqual([]);
  });

  test("removes known protected destinations from a public snapshot", async () => {
    const permissions = new PageInspectionPermissionService({ isChromiumAvailable: () => true });
    permissions.allowPublic("session-one");
    const service = new PageInspectionService(permissions, {
      inspect: async () => ({
        ...snapshot,
        forms: [{ method: "GET", action: "https://target.example/account", fields: [] }],
        links: [
          { url: "https://target.example/public", text: "Public" },
          { url: "https://target.example/admin", text: "Admin" },
        ],
        scripts: [
          { src: "https://target.example/admin/runtime.js", type: "module" },
          { src: "https://cdn.example/runtime.js", type: "module" },
        ],
      }),
    });

    await expect(
      service.inspect({
        sessionId: "session-one",
        requestedUrl: "https://target.example/public",
        targetOrigin: "https://target.example",
        protectedPaths: ["https://target.example/admin", "https://target.example/account"],
      }),
    ).resolves.toMatchObject({
      forms: [],
      links: [{ url: "https://target.example/public", text: "Public" }],
      scripts: [{ src: "https://cdn.example/runtime.js", type: "module" }],
      isPartial: true,
      truncatedSections: ["protected_paths"],
    });
  });
});
