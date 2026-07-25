import { AuthenticatedRequestContext } from "../../authentication/model/authenticated-request-context.types";
import { authCheckService } from "../../authentication/services/auth-check.service";
import { authenticatedRequestContextService } from "../../authentication/services/authenticated-request-context.service";
import { defaultPageInspectionLimits } from "../config/page-inspection.config";
import {
  PageInspectionAuthentication,
  PageInspectionBrowser,
  PageInspectionRequest,
} from "../model/page-inspection.types";
import { PageInspectionPermissionService, pageInspectionPermissionService } from "./page-inspection-permission.service";
import { isPageInspectionProtectedUrl } from "./page-inspection-protected-path.helpers";
import {
  applyPageInspectionBounds,
  excludePageInspectionProtectedPaths,
} from "./page-inspection-snapshot.helpers";
import { isRejectedPageInspectionAuthentication } from "./page-inspection-authentication.helpers";
import {
  PageInspectionAuthenticationSelectionService,
  pageInspectionAuthenticationSelectionService,
} from "./page-inspection-authentication-selection.service";
import { PlaywrightPageInspectionBrowser } from "./playwright-page-inspection-browser.service";

export class PageInspectionService {
  constructor(
    private readonly permissions: PageInspectionPermissionService = pageInspectionPermissionService,
    private readonly browser: PageInspectionBrowser = new PlaywrightPageInspectionBrowser(),
    private readonly contextLoader: PageInspectionContextLoader = authenticatedRequestContextService,
    private readonly authenticationAcceptance: PageInspectionAuthenticationAcceptance = authCheckService,
    private readonly authenticationSelection: PageInspectionAuthenticationSelection = pageInspectionAuthenticationSelectionService,
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
    const authentication = await this.loadAuthentication(request, targetOrigin);
    if (
      !authentication &&
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
        authentication,
      },
      defaultPageInspectionLimits,
    );
    if (authentication && isRejectedPageInspectionAuthentication(snapshot)) {
      throw new Error("Selected authentication context was rejected by the target. Run Auth Check again.");
    }
    if (new URL(snapshot.finalUrl).origin !== targetOrigin) {
      throw new Error("Page Inspection blocked an out-of-origin redirect.");
    }
    if (
      !authentication &&
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

  private async loadAuthentication(
    request: PageInspectionRequest,
    targetOrigin: string,
  ): Promise<PageInspectionAuthentication | undefined> {
    const mode = request.authenticationMode ?? "public";
    if (mode === "public") {
      return undefined;
    }
    if (mode !== "accepted_context") {
      throw new Error("Page Inspection authentication mode is invalid.");
    }
    const hasOperatorSelection = this.authenticationSelection.consume(
      request.sessionId,
      this.contextLoader.getAuthStateVersion(request.sessionId),
    );
    if (!this.authenticationAcceptance.isProceedAllowed(request.sessionId)) {
      throw new Error(
        "Selected authentication context is not accepted. Run Auth Check or acknowledge its inconclusive result before inspecting with it.",
      );
    }
    if (!hasOperatorSelection) {
      throw new Error(
        "Selected authentication context requires operator selection for this inspection. Open Page Inspection permission and select the accepted context.",
      );
    }

    const context = await this.contextLoader.loadProtectedContext(request.sessionId);
    if (!context) {
      throw new Error("Selected authentication context is unavailable. Save a context before inspecting with it.");
    }
    if (context.origin !== targetOrigin) {
      throw new Error("Selected authentication context does not match the target's exact origin.");
    }

    return {
      origin: context.origin,
      cookies: context.cookies,
      headers: context.headers,
    };
  }
}

export const pageInspectionService = new PageInspectionService();

interface PageInspectionContextLoader {
  getAuthStateVersion: (sessionId: string) => number;
  loadProtectedContext: (sessionId: string) => Promise<AuthenticatedRequestContext | null>;
}

interface PageInspectionAuthenticationAcceptance {
  isProceedAllowed: (sessionId: string) => boolean;
}

interface PageInspectionAuthenticationSelection {
  consume: (sessionId: string, authStateVersion: number) => boolean;
}
