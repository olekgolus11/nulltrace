import {
  AuthenticatedRequestContext,
  AuthenticatedRequestContextMetadata,
} from "../../authentication/model/authenticated-request-context.types";
import { authCheckService } from "../../authentication/services/auth-check.service";
import { authenticatedRequestContextService } from "../../authentication/services/authenticated-request-context.service";
import { defaultPageInspectionLimits } from "../config/page-inspection.config";
import {
  PageInspectionAuthentication,
  PageInspectionBrowser,
  PageInspectionPermissionMode,
  PageInspectionRequest,
} from "../model/page-inspection.types";
import {
  PageInspectionPermissionService,
  pageInspectionPermissionService,
} from "./page-inspection-permission.service";
import { isPageInspectionProtectedUrl } from "./page-inspection-protected-path.helpers";
import {
  applyPageInspectionBounds,
  excludePageInspectionProtectedPaths,
} from "./page-inspection-snapshot.helpers";
import { isRejectedPageInspectionAuthentication } from "./page-inspection-authentication.helpers";
import { PlaywrightPageInspectionBrowser } from "./playwright-page-inspection-browser.service";

export class PageInspectionService {
  constructor(
    private readonly permissions: PageInspectionPermissionService = pageInspectionPermissionService,
    private readonly browser: PageInspectionBrowser = new PlaywrightPageInspectionBrowser(),
    private readonly contextLoader: PageInspectionContextLoader = authenticatedRequestContextService,
    private readonly authenticationAcceptance: PageInspectionAuthenticationAcceptance = authCheckService,
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
    const authentication = await this.loadAuthentication(
      request.sessionId,
      targetOrigin,
      permission.mode,
    );
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

    const snapshotForOutput = authentication
      ? snapshot
      : excludePageInspectionProtectedPaths(
          snapshot,
          targetOrigin,
          request.protectedPaths ?? [],
        );
    return applyPageInspectionBounds(snapshotForOutput, defaultPageInspectionLimits);
  }

  private async loadAuthentication(
    sessionId: string,
    targetOrigin: string,
    permissionMode: PageInspectionPermissionMode,
  ): Promise<PageInspectionAuthentication | undefined> {
    if (permissionMode !== "authenticated") {
      return undefined;
    }
    if (!this.authenticationAcceptance.isProceedAllowed(sessionId)) {
      throw new Error(
        "Authenticated Page Inspection requires an accepted authentication context. Run Auth Check or acknowledge its inconclusive result.",
      );
    }
    const metadata = await this.contextLoader.getMetadata(sessionId);
    if (!metadata) {
      throw new Error(
        "Authenticated Page Inspection context is unavailable. Save an authentication context first.",
      );
    }
    if (metadata.storageMode !== "secure") {
      throw new Error(
        "Authenticated Page Inspection requires a platform secure store. Memory-only authentication contexts cannot cross the isolated inspection runtime.",
      );
    }

    const context = await this.contextLoader.loadProtectedContext(sessionId);
    if (!context) {
      throw new Error(
        "Authenticated Page Inspection context is unavailable. Save an authentication context first.",
      );
    }
    if (context.origin !== targetOrigin) {
      throw new Error(
        "Authenticated Page Inspection context does not match the target's exact origin.",
      );
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
  getMetadata: (
    sessionId: string,
  ) => Promise<Pick<AuthenticatedRequestContextMetadata, "storageMode"> | null>;
  loadProtectedContext: (sessionId: string) => Promise<AuthenticatedRequestContext | null>;
}

interface PageInspectionAuthenticationAcceptance {
  isProceedAllowed: (sessionId: string) => boolean;
}
