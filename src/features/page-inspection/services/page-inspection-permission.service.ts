import {
  PageInspectionPermissionDependencies,
  PageInspectionPermissionStatus,
} from "../model/page-inspection.types";
import { readPageInspectionAllowedSessionIds } from "./page-inspection-permission.helpers";
import { isChromiumAvailable } from "./playwright-page-inspection-browser.helpers";

export class PageInspectionPermissionService {
  private readonly allowedSessionIds = new Set<string>();

  constructor(
    private readonly dependencies: PageInspectionPermissionDependencies = {
      isChromiumAvailable,
    },
  ) {
    readPageInspectionAllowedSessionIds().forEach((sessionId) => this.allowedSessionIds.add(sessionId));
  }

  grant(sessionId: string) {
    this.allowedSessionIds.add(sessionId);
  }

  revoke(sessionId: string) {
    this.allowedSessionIds.delete(sessionId);
  }

  getStatus(sessionId: string): PageInspectionPermissionStatus {
    const isAllowed = this.allowedSessionIds.has(sessionId);
    return {
      isAllowed,
      status: !this.dependencies.isChromiumAvailable()
        ? "browser_missing"
        : isAllowed
          ? "ready"
          : "blocked",
    };
  }

  listAllowedSessionIds() {
    return [...this.allowedSessionIds];
  }
}

export const pageInspectionPermissionService = new PageInspectionPermissionService();
