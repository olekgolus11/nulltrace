import { expect, test } from "bun:test";
import type { BrowserType } from "playwright";
import { defaultPageInspectionLimits } from "../../config/page-inspection.config";
import { PlaywrightPageInspectionBrowser } from "../playwright-page-inspection-browser.service";

interface FakeRouteHandler {
  (route: {
    request: () => {
      frame: () => unknown;
      headers: () => Record<string, string>;
      method: () => string;
      resourceType: () => string;
      url: () => string;
    };
    continue: (options?: { headers?: Record<string, string> }) => Promise<void>;
    abort: () => Promise<void>;
  }): Promise<void>;
}

function createFakeBrowserType(
  shouldFailNavigation = false,
  shouldFailRender = false,
  shouldDelayExtraction = false,
  failureMessage = "network failed",
  snapshotSecret = "",
) {
  let contextClosed = 0;
  let browserClosed = 0;
  let newContextCalls = 0;
  let contextOptions: unknown = null;
  let routeHandler: FakeRouteHandler | null = null;
  let hasWebSocketRoute = false;
  let addedCookies: unknown = null;
  let clearedCookies = 0;
  let isContextClosed = false;
  let evaluateArguments: unknown = null;
  const pageEventNames: string[] = [];
  const extracted = {
    title: "Client rendered page",
    visibleText: "Rendered by JavaScript.",
    forms: [
      {
        method: "POST",
        action: "https://target.example/app/login",
        fields: [{ name: "email", type: "email", isRequired: true }],
      },
    ],
    links: [{ url: "https://target.example/app/about", text: "About" }],
    scripts: [{ src: "https://cdn.example/app.js", type: "module" }],
    domOutline: [],
    metadata: [{ name: "description", content: `Rendered application ${snapshotSecret}` }],
    hasPasswordFields: true,
    truncatedSections: [],
  };
  const mainFrame = {};
  const page = {
    on: (eventName: string) => {
      pageEventNames.push(eventName);
    },
    goto: async () => {
      if (shouldFailNavigation) {
        throw new Error(failureMessage);
      }
      return {
        headers: () => ({
          "content-type": "text/html",
          "content-security-policy": "default-src 'self'",
        }),
        status: () => 200,
      };
    },
    url: () => "https://target.example/app",
    waitForLoadState: async () => {
      if (shouldFailRender) {
        throw new Error("render timed out");
      }
    },
    mainFrame: () => mainFrame,
    evaluate: async <T>(_callback: unknown, argumentsValue: unknown) => {
      evaluateArguments = argumentsValue;
      if (shouldDelayExtraction) {
        await Promise.resolve();
      }
      if (isContextClosed) {
        throw new Error("Target page, context or browser has been closed");
      }
      return extracted as T;
    },
  };
  const context = {
    on: () => {},
    route: async (_pattern: string, handler: FakeRouteHandler) => {
      routeHandler = handler;
    },
    routeWebSocket: async () => {
      hasWebSocketRoute = true;
    },
    addCookies: async (cookies: unknown) => {
      addedCookies = cookies;
    },
    clearCookies: async () => {
      clearedCookies += 1;
    },
    newPage: async () => page,
    close: async () => {
      isContextClosed = true;
      contextClosed += 1;
    },
  };
  const browser = {
    newContext: async (options: unknown) => {
      isContextClosed = false;
      newContextCalls += 1;
      contextOptions = options;
      return context;
    },
    close: async () => {
      browserClosed += 1;
    },
  };

  return {
    browserType: {
      launch: async () => browser,
    } as unknown as Pick<BrowserType, "launch">,
    getState: () => ({
      browserClosed,
      contextClosed,
      newContextCalls,
      contextOptions,
      hasWebSocketRoute,
      addedCookies,
      pageEventNames,
      clearedCookies,
      evaluateArguments,
      routeHandler,
    }),
  };
}

test("uses an isolated context, renders JavaScript content, and cleans up", async () => {
  const fake = createFakeBrowserType();
  const browser = new PlaywrightPageInspectionBrowser({ browserType: fake.browserType });

  await expect(
    browser.inspect(
      {
        requestedUrl: "https://target.example/app",
        targetOrigin: "https://target.example",
      },
      defaultPageInspectionLimits,
    ),
  ).resolves.toMatchObject({
    title: "Client rendered page",
    visibleText: "Rendered by JavaScript.",
    contentType: "text/html",
    securitySignals: {
      contentSecurityPolicy: "default-src 'self'",
      hasPasswordFields: true,
    },
  });

  await browser.inspect(
    {
      requestedUrl: "https://target.example/app/second",
      targetOrigin: "https://target.example",
    },
    defaultPageInspectionLimits,
  );

  expect(fake.getState().contextOptions).toEqual({
    acceptDownloads: false,
    serviceWorkers: "block",
  });
  expect(fake.getState().newContextCalls).toBe(2);
  expect(fake.getState().contextClosed).toBe(2);
  expect(fake.getState().browserClosed).toBe(2);
  expect(fake.getState().hasWebSocketRoute).toBe(true);
  expect(fake.getState().pageEventNames).toEqual(expect.arrayContaining(["popup", "download"]));
  expect(fake.getState().evaluateArguments).toEqual({
    maxDomOutlineNodes: defaultPageInspectionLimits.maxDomOutlineNodes,
    maxForms: defaultPageInspectionLimits.maxForms,
    maxFormFields: defaultPageInspectionLimits.maxFormFields,
    maxLinks: defaultPageInspectionLimits.maxLinks,
    maxMetadataEntries: defaultPageInspectionLimits.maxMetadataEntries,
    maxScripts: defaultPageInspectionLimits.maxScripts,
    maxVisibleTextCharacters: defaultPageInspectionLimits.maxVisibleTextCharacters,
  });
});

test("injects selected authentication only into exact-origin requests and clears it after inspection", async () => {
  const fake = createFakeBrowserType();
  const browser = new PlaywrightPageInspectionBrowser({ browserType: fake.browserType });

  await expect(
    browser.inspect(
      {
        requestedUrl: "https://target.example/app",
        targetOrigin: "https://target.example",
        authentication: {
          origin: "https://target.example",
          cookies: "session=secret-cookie\ncsrf=secret-csrf",
          headers: "Authorization: Bearer secret-header | X-CSRF-Token: secret-token",
        },
      },
      defaultPageInspectionLimits,
    ),
  ).resolves.toMatchObject({
    title: "Client rendered page",
    visibleText: "Rendered by JavaScript.",
  });

  expect(fake.getState().addedCookies).toEqual([
    { name: "session", value: "secret-cookie", url: "https://target.example" },
    { name: "csrf", value: "secret-csrf", url: "https://target.example" },
  ]);
  expect(fake.getState().clearedCookies).toBe(1);

  const routeHandler = fake.getState().routeHandler;
  expect(routeHandler).not.toBeNull();
  const continued: Array<Record<string, string> | undefined> = [];
  await routeHandler?.({
    request: () => ({
      frame: () => ({}),
      headers: () => ({ accept: "application/javascript" }),
      method: () => "GET",
      resourceType: () => "script",
      url: () => "https://target.example/app/runtime.js",
    }),
    continue: async (options) => {
      continued.push(options?.headers);
    },
    abort: async () => {},
  });
  await routeHandler?.({
    request: () => ({
      frame: () => ({}),
      headers: () => ({ accept: "application/javascript" }),
      method: () => "GET",
      resourceType: () => "script",
      url: () => "https://cdn.example/runtime.js",
    }),
    continue: async (options) => {
      continued.push(options?.headers);
    },
    abort: async () => {},
  });

  const blockedRedirect: string[] = [];
  await routeHandler?.({
    request: () => ({
      frame: () => ({}),
      headers: () => ({ cookie: "session=secret-cookie" }),
      method: () => "GET",
      resourceType: () => "document",
      url: () => "https://outside.example/redirected",
    }),
    continue: async () => {
      blockedRedirect.push("continued");
    },
    abort: async () => {
      blockedRedirect.push("aborted");
    },
  });

  expect(continued).toEqual([
    {
      accept: "application/javascript",
      Authorization: "Bearer secret-header",
      "X-CSRF-Token": "secret-token",
    },
    undefined,
  ]);
  expect(blockedRedirect).toEqual(["aborted"]);
});

test("redacts authentication values from snapshots and browser errors", async () => {
  const authentication = {
    origin: "https://target.example",
    cookies: "session=secret-cookie",
    headers: "Authorization: Bearer secret-header | X-CSRF-Token: secret-token",
  };
  const snapshotBrowser = new PlaywrightPageInspectionBrowser({
    browserType: createFakeBrowserType(
      false,
      false,
      false,
      "network failed",
      "secret-cookie Bearer secret-header secret-token",
    ).browserType,
  });

  const snapshot = await snapshotBrowser.inspect(
    {
      requestedUrl: "https://target.example/app",
      targetOrigin: "https://target.example",
      authentication,
    },
    defaultPageInspectionLimits,
  );
  expect(JSON.stringify(snapshot)).not.toContain("secret-cookie");
  expect(JSON.stringify(snapshot)).not.toContain("secret-header");
  expect(JSON.stringify(snapshot)).not.toContain("secret-token");

  const errorBrowser = new PlaywrightPageInspectionBrowser({
    browserType: createFakeBrowserType(
      true,
      false,
      false,
      "Navigation failed: Bearer secret-header",
    ).browserType,
  });
  await expect(
    errorBrowser.inspect(
      {
        requestedUrl: "https://target.example/app",
        targetOrigin: "https://target.example",
        authentication,
      },
      defaultPageInspectionLimits,
    ),
  ).rejects.toThrow("Navigation failed: [redacted]");
});

test("cleans authentication after an interrupted navigation", async () => {
  const fake = createFakeBrowserType(true);
  const browser = new PlaywrightPageInspectionBrowser({ browserType: fake.browserType });

  await expect(
    browser.inspect(
      {
        requestedUrl: "https://target.example/app",
        targetOrigin: "https://target.example",
        authentication: {
          origin: "https://target.example",
          cookies: "session=cleanup-secret",
          headers: "Authorization: Bearer cleanup-secret",
        },
      },
      defaultPageInspectionLimits,
    ),
  ).rejects.toThrow("network failed");
  expect(fake.getState().clearedCookies).toBe(1);
  expect(fake.getState().contextClosed).toBe(1);
  expect(fake.getState().browserClosed).toBe(1);
});

test("keeps the context open until asynchronous snapshot extraction completes", async () => {
  const fake = createFakeBrowserType(false, false, true);
  const browser = new PlaywrightPageInspectionBrowser({ browserType: fake.browserType });

  await expect(
    browser.inspect(
      {
        requestedUrl: "https://target.example/app",
        targetOrigin: "https://target.example",
      },
      defaultPageInspectionLimits,
    ),
  ).resolves.toMatchObject({ title: "Client rendered page" });
  expect(fake.getState().contextClosed).toBe(1);
});

test("enforces request policy and cleans up after navigation failure", async () => {
  const fake = createFakeBrowserType(true);
  const browser = new PlaywrightPageInspectionBrowser({ browserType: fake.browserType });

  await expect(
    browser.inspect(
      {
        requestedUrl: "https://target.example/app",
        targetOrigin: "https://target.example",
      },
      defaultPageInspectionLimits,
    ),
  ).rejects.toThrow("network failed");
  expect(fake.getState().contextClosed).toBe(1);
  expect(fake.getState().browserClosed).toBe(1);

  const routeHandler = fake.getState().routeHandler;
  expect(routeHandler).not.toBeNull();
  const blocked: string[] = [];
  await routeHandler?.({
    request: () => ({
      frame: () => ({}),
      headers: () => ({}),
      method: () => "POST",
      resourceType: () => "fetch",
      url: () => "https://target.example/api/beacon",
    }),
    continue: async () => {
      blocked.push("continued");
    },
    abort: async () => {
      blocked.push("aborted");
    },
  });
  expect(blocked).toEqual(["aborted"]);

  await routeHandler?.({
    request: () => ({
      frame: () => ({}),
      headers: () => ({}),
      method: () => "GET",
      resourceType: () => "document",
      url: () => "https://outside.example/redirected",
    }),
    continue: async () => {
      blocked.push("continued external document");
    },
    abort: async () => {
      blocked.push("aborted external document");
    },
  });
  expect(blocked).toContain("aborted external document");
});

test("returns a labeled partial snapshot when rendering does not become idle", async () => {
  const fake = createFakeBrowserType(false, true);
  const browser = new PlaywrightPageInspectionBrowser({ browserType: fake.browserType });

  await expect(
    browser.inspect(
      {
        requestedUrl: "https://target.example/app",
        targetOrigin: "https://target.example",
      },
      defaultPageInspectionLimits,
    ),
  ).resolves.toMatchObject({
    isPartial: true,
    truncatedSections: ["render_wait"],
  });
  expect(fake.getState().contextClosed).toBe(1);
  expect(fake.getState().browserClosed).toBe(1);
});
