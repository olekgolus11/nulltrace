import { describe, expect, test } from "bun:test";
import { PageInspectionSnapshot } from "../../model/page-inspection.types";
import { PageInspectionPermissionService } from "../page-inspection-permission.service";
import { PageInspectionAuthenticationSelectionService } from "../page-inspection-authentication-selection.service";
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
    permissions.grant("session-one");
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

  test("defaults to public inspection and injects an explicitly selected accepted context", async () => {
    const browser = new FakePageInspectionBrowser();
    const permissions = new PageInspectionPermissionService({ isChromiumAvailable: () => true });
    permissions.grant("session-one");
    const selection = new PageInspectionAuthenticationSelectionService();
    selection.select("session-one", 1);
    const service = new PageInspectionService(
      permissions,
      browser,
      {
        getAuthStateVersion: () => 1,
        loadProtectedContext: async () => ({
          origin: "https://target.example",
          cookies: "session=secret-cookie",
          headers: "Authorization: Bearer secret-header",
          updatedAt: "2026-07-25T10:00:00.000Z",
        }),
      },
      { isProceedAllowed: () => true },
      selection,
    );

    await service.inspect({
      sessionId: "session-one",
      requestedUrl: "https://target.example/public",
      targetOrigin: "https://target.example",
    });
    await service.inspect({
      sessionId: "session-one",
      requestedUrl: "https://target.example/private",
      targetOrigin: "https://target.example",
      authenticationMode: "accepted_context",
      protectedPaths: ["https://target.example/private"],
    });

    expect(browser.calls).toEqual([
      {
        requestedUrl: "https://target.example/public",
        targetOrigin: "https://target.example",
      },
      {
        requestedUrl: "https://target.example/private",
        targetOrigin: "https://target.example",
        authentication: {
          origin: "https://target.example",
          cookies: "session=secret-cookie",
          headers: "Authorization: Bearer secret-header",
        },
      },
    ]);
  });

  test("rejects rejected, missing, and incompatible selected contexts without public fallback", async () => {
    const rejectedBrowser = new FakePageInspectionBrowser();
    const permissions = new PageInspectionPermissionService({ isChromiumAvailable: () => true });
    permissions.grant("session-one");
    const rejectedService = new PageInspectionService(
      permissions,
      rejectedBrowser,
      { getAuthStateVersion: () => 1, loadProtectedContext: async () => null },
      { isProceedAllowed: () => false },
    );
    await expect(
      rejectedService.inspect({
        sessionId: "session-one",
        requestedUrl: "https://target.example/private",
        targetOrigin: "https://target.example",
        authenticationMode: "accepted_context",
      }),
    ).rejects.toThrow("not accepted");
    expect(rejectedBrowser.calls).toEqual([]);

    const missingBrowser = new FakePageInspectionBrowser();
    const missingSelection = new PageInspectionAuthenticationSelectionService();
    missingSelection.select("session-one", 1);
    const missingService = new PageInspectionService(
      permissions,
      missingBrowser,
      { getAuthStateVersion: () => 1, loadProtectedContext: async () => null },
      { isProceedAllowed: () => true },
      missingSelection,
    );
    await expect(
      missingService.inspect({
        sessionId: "session-one",
        requestedUrl: "https://target.example/private",
        targetOrigin: "https://target.example",
        authenticationMode: "accepted_context",
      }),
    ).rejects.toThrow("unavailable");
    expect(missingBrowser.calls).toEqual([]);

    const incompatibleBrowser = new FakePageInspectionBrowser();
    const incompatibleSelection = new PageInspectionAuthenticationSelectionService();
    incompatibleSelection.select("session-one", 1);
    const incompatibleService = new PageInspectionService(
      permissions,
      incompatibleBrowser,
      {
        getAuthStateVersion: () => 1,
        loadProtectedContext: async () => ({
          origin: "https://other.example",
          cookies: "session=wrong-context",
          headers: "",
          updatedAt: "2026-07-25T10:00:00.000Z",
        }),
      },
      { isProceedAllowed: () => true },
      incompatibleSelection,
    );
    await expect(
      incompatibleService.inspect({
        sessionId: "session-one",
        requestedUrl: "https://target.example/private",
        targetOrigin: "https://target.example",
        authenticationMode: "accepted_context",
      }),
    ).rejects.toThrow("exact origin");
    expect(incompatibleBrowser.calls).toEqual([]);
  });

  test("requires operator selection before using an accepted context", async () => {
    const browser = new FakePageInspectionBrowser();
    const permissions = new PageInspectionPermissionService({ isChromiumAvailable: () => true });
    permissions.grant("session-one");
    const service = new PageInspectionService(
      permissions,
      browser,
      {
        getAuthStateVersion: () => 1,
        loadProtectedContext: async () => ({
          origin: "https://target.example",
          cookies: "session=unselected-context",
          headers: "",
          updatedAt: "2026-07-25T10:00:00.000Z",
        }),
      },
      { isProceedAllowed: () => true },
      new PageInspectionAuthenticationSelectionService(),
    );

    await expect(
      service.inspect({
        sessionId: "session-one",
        requestedUrl: "https://target.example/private",
        targetOrigin: "https://target.example",
        authenticationMode: "accepted_context",
      }),
    ).rejects.toThrow("requires operator selection");
    expect(browser.calls).toEqual([]);
  });

  test("allows an accepted context to finish on its selected protected page", async () => {
    const permissions = new PageInspectionPermissionService({ isChromiumAvailable: () => true });
    permissions.grant("session-one");
    const selection = new PageInspectionAuthenticationSelectionService();
    selection.select("session-one", 1);
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
        getAuthStateVersion: () => 1,
        loadProtectedContext: async () => ({
          origin: "https://target.example",
          cookies: "session=selected-context",
          headers: "",
          updatedAt: "2026-07-25T10:00:00.000Z",
        }),
      },
      { isProceedAllowed: () => true },
      selection,
    );

    await expect(
      service.inspect({
        sessionId: "session-one",
        requestedUrl: "https://target.example/private",
        targetOrigin: "https://target.example",
        protectedPaths: ["https://target.example/private"],
        authenticationMode: "accepted_context",
      }),
    ).resolves.toMatchObject({ finalUrl: "https://target.example/private" });
  });

  test("reports a rejected selected context without falling back to public inspection", async () => {
    const permissions = new PageInspectionPermissionService({ isChromiumAvailable: () => true });
    permissions.grant("session-one");
    const selection = new PageInspectionAuthenticationSelectionService();
    selection.select("session-one", 1);
    const service = new PageInspectionService(
      permissions,
      {
        inspect: async () => ({
          ...snapshot,
          finalUrl: "https://target.example/login",
          status: 200,
        }),
      },
      {
        getAuthStateVersion: () => 1,
        loadProtectedContext: async () => ({
          origin: "https://target.example",
          cookies: "session=expired-context",
          headers: "",
          updatedAt: "2026-07-25T10:00:00.000Z",
        }),
      },
      { isProceedAllowed: () => true },
      selection,
    );

    await expect(
      service.inspect({
        sessionId: "session-one",
        requestedUrl: "https://target.example/private",
        targetOrigin: "https://target.example",
        authenticationMode: "accepted_context",
      }),
    ).rejects.toThrow("rejected by the target");
  });

  test("rejects cross-origin requests before browser navigation", async () => {
    const browser = new FakePageInspectionBrowser();
    const permissions = new PageInspectionPermissionService({ isChromiumAvailable: () => true });
    permissions.grant("session-one");
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
    permissions.grant("session-one");
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
    permissions.grant("session-one");
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
    permissions.grant("session-one");
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
    permissions.grant("session-one");
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
    permissions.grant("session-one");
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
