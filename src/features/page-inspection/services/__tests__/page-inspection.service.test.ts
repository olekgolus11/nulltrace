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
  calls: Array<{ requestedUrl: string; targetOrigin: string }> = [];

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
