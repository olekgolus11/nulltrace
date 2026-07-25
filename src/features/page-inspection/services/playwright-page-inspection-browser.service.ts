import { chromium, type Browser, type BrowserContext, type Page } from "playwright";
import {
  PageInspectionBrowser,
  PageInspectionInput,
  PageInspectionLimits,
  PageInspectionSnapshot,
} from "../model/page-inspection.types";
import { PageInspectionBrowserDependencies } from "../model/playwright-page-inspection-browser.types";
import {
  createPlaywrightPageInspectionAuthentication,
  mergePlaywrightPageInspectionHeaders,
  redactPlaywrightPageInspectionError,
  redactPlaywrightPageInspectionSnapshot,
} from "./playwright-page-inspection-authentication.helpers";
import { getPageInspectionRequestDecision } from "./page-inspection-request-policy.helpers";
import { isMissingChromiumError } from "./playwright-page-inspection-browser.helpers";
import { extractPlaywrightPageInspectionSnapshot } from "./playwright-page-inspection-snapshot.helpers";

export class PlaywrightPageInspectionBrowser implements PageInspectionBrowser {
  constructor(
    private readonly dependencies: PageInspectionBrowserDependencies = { browserType: chromium },
  ) {}

  async inspect(
    input: PageInspectionInput,
    limits: PageInspectionLimits,
  ): Promise<PageInspectionSnapshot> {
    if (input.authentication && input.authentication.origin !== input.targetOrigin) {
      throw new Error("Page Inspection authentication context must match the target's exact origin.");
    }
    let browser: Browser | null = null;
    let context: BrowserContext | null = null;
    let page: Page | null = null;
    let blockedOutOfOriginDocument = false;

    try {
      browser = await this.dependencies.browserType.launch({ headless: true });
      context = await browser.newContext({
        acceptDownloads: false,
        serviceWorkers: "block",
      });
      const authentication = input.authentication
        ? createPlaywrightPageInspectionAuthentication(input.authentication)
        : null;
      if (authentication?.cookies.length) {
        await context.addCookies(authentication.cookies);
      }
      await context.route("**/*", async (route) => {
        const request = route.request();
        const decision = getPageInspectionRequestDecision({
          method: request.method(),
          isMainFrame: page !== null && request.frame() === page.mainFrame(),
          resourceType: request.resourceType(),
          targetOrigin: input.targetOrigin,
          url: request.url(),
        });
        if (decision === "allow") {
          if (authentication && new URL(request.url()).origin === input.targetOrigin) {
            await route.continue({
              headers: mergePlaywrightPageInspectionHeaders(
                request.headers(),
                authentication.headers,
              ),
            });
            return;
          }
          await route.continue();
          return;
        }
        if (request.resourceType() === "document" && new URL(request.url()).origin !== input.targetOrigin) {
          blockedOutOfOriginDocument = true;
        }
        await route.abort();
      });
      await context.routeWebSocket("**/*", (webSocket) => webSocket.close());

      let initialPage: Page | null = null;
      context.on("page", (nextPage) => {
        if (initialPage && nextPage !== initialPage) {
          void nextPage.close();
        }
      });
      page = await context.newPage();
      initialPage = page;
      page.on("popup", (popup) => {
        void popup.close();
      });
      page.on("download", (download) => {
        void download.cancel();
      });

      let response: Awaited<ReturnType<typeof page.goto>>;
      try {
        response = await page.goto(input.requestedUrl, {
          timeout: limits.navigationTimeoutMs,
          waitUntil: "domcontentloaded",
        });
      } catch (error) {
        if (blockedOutOfOriginDocument) {
          throw new Error("Page Inspection blocked an out-of-origin redirect.");
        }
        throw error;
      }

      if (new URL(page.url()).origin !== input.targetOrigin) {
        throw new Error("Page Inspection blocked an out-of-origin redirect.");
      }
      let isRenderWaitPartial = false;
      await page.waitForLoadState("networkidle", { timeout: limits.renderWaitTimeoutMs }).catch(() => {
        isRenderWaitPartial = true;
      });

      return redactPlaywrightPageInspectionSnapshot(
        await extractPlaywrightPageInspectionSnapshot(
          page,
          response,
          input,
          limits,
          isRenderWaitPartial,
        ),
        input.authentication,
      );
    } catch (error) {
      if (isMissingChromiumError(error)) {
        throw new Error(
          'Page Inspection unavailable: Chromium is not installed. Install it with "bunx playwright install chromium", then restart NullTrace.',
        );
      }
      throw redactPlaywrightPageInspectionError(error, input.authentication);
    } finally {
      if (context) {
        await context.clearCookies().catch(() => {});
        await context.close().catch(() => {});
      }
      if (browser) {
        await browser.close().catch(() => {});
      }
    }
  }
}
