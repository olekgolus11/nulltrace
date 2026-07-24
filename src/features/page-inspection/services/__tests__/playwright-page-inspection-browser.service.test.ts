import { expect, test } from "bun:test";
import type { BrowserType } from "playwright";
import { defaultPageInspectionLimits } from "../../config/page-inspection.config";
import { PlaywrightPageInspectionBrowser } from "../playwright-page-inspection-browser.service";

interface FakeRouteHandler {
  (route: {
    request: () => {
      frame: () => unknown;
      method: () => string;
      resourceType: () => string;
      url: () => string;
    };
    continue: () => Promise<void>;
    abort: () => Promise<void>;
  }): Promise<void>;
}

function createFakeBrowserType(
  shouldFailNavigation = false,
  shouldFailRender = false,
  shouldDelayExtraction = false,
) {
  let contextClosed = 0;
  let browserClosed = 0;
  let newContextCalls = 0;
  let contextOptions: unknown = null;
  let routeHandler: FakeRouteHandler | null = null;
  let hasWebSocketRoute = false;
  let isContextClosed = false;
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
    metadata: [{ name: "description", content: "Rendered application" }],
    hasPasswordFields: true,
  };
  const mainFrame = {};
  const page = {
    on: (eventName: string) => {
      pageEventNames.push(eventName);
    },
    goto: async () => {
      if (shouldFailNavigation) {
        throw new Error("network failed");
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
    evaluate: async <T>() => {
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
      pageEventNames,
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
