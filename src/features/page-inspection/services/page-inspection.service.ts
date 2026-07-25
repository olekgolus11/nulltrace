import { defaultPageInspectionLimits } from "../config/page-inspection.config";
import { PageInspectionBrowser, PageInspectionRequest } from "../model/page-inspection.types";
import { PageInspectionPermissionService, pageInspectionPermissionService } from "./page-inspection-permission.service";
import { isPageInspectionProtectedUrl } from "./page-inspection-protected-path.helpers";
import {
  applyPageInspectionBounds,
  excludePageInspectionProtectedPaths,
} from "./page-inspection-snapshot.helpers";
import { PlaywrightPageInspectionBrowser } from "./playwright-page-inspection-browser.service";

export class PageInspectionService {
  constructor(
    private readonly permissions: PageInspectionPermissionService = pageInspectionPermissionService,
    private readonly browser: PageInspectionBrowser = new PlaywrightPageInspectionBrowser(),
  ) {}

  async inspect(request: PageInspectionRequest) {
    const permission = this.permissions.getStatus(request.sessionId);
    if (!permission.isAllowed) {
      throw new Error("Page Inspection is blocked for this testing session.");
    }
    if (permission.status === "browser_missing") {
      throw new Error(
        'Page Inspection unavailable: Chromium is not installed. Install it with "bunx playwright install chromium", then restart NullTrace.',
      );
    }

    const targetOrigin = new URL(request.targetOrigin).origin;
    const requestedUrl = new URL(request.requestedUrl);
    if (requestedUrl.toString().length > 2_048) {
      throw new Error("Page Inspection URL is too long.");
    }
    if (requestedUrl.origin !== targetOrigin) {
      throw new Error("Page Inspection only allows the exact target origin.");
    }
    if (
      isPageInspectionProtectedUrl(
        requestedUrl.toString(),
        targetOrigin,
        request.protectedPaths ?? [],
      )
    ) {
      throw new Error("Page Inspection does not inspect known protected paths.");
    }

    const snapshot = await this.browser.inspect(
      {
        requestedUrl: requestedUrl.toString(),
        targetOrigin,
      },
      defaultPageInspectionLimits,
    );
    if (new URL(snapshot.finalUrl).origin !== targetOrigin) {
      throw new Error("Page Inspection blocked an out-of-origin redirect.");
    }
    if (
      isPageInspectionProtectedUrl(
        snapshot.finalUrl,
        targetOrigin,
        request.protectedPaths ?? [],
      )
    ) {
      throw new Error("Page Inspection does not inspect known protected paths.");
    }

    return applyPageInspectionBounds(
      excludePageInspectionProtectedPaths(snapshot, targetOrigin, request.protectedPaths ?? []),
      defaultPageInspectionLimits,
    );
  }
}

export const pageInspectionService = new PageInspectionService();
