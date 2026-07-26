import {
  PageInspectionAllowedMode,
  PageInspectionPermissionDependencies,
  PageInspectionPermissionStatus,
} from "../model/page-inspection.types";
import { readPageInspectionPermissionModes } from "./page-inspection-permission.helpers";
import { isChromiumAvailable } from "./playwright-page-inspection-browser.helpers";

export class PageInspectionPermissionService {
  private readonly modes = new Map<string, PageInspectionAllowedMode>();

  constructor(
    private readonly dependencies: PageInspectionPermissionDependencies = {
      isChromiumAvailable,
    },
  ) {
    Object.entries(readPageInspectionPermissionModes()).forEach(([sessionId, mode]) => {
      this.modes.set(sessionId, mode);
    });
  }

  allowPublic(sessionId: string) {
    this.modes.set(sessionId, "public");
  }

  allowAuthenticated(sessionId: string) {
    this.modes.set(sessionId, "authenticated");
  }

  revoke(sessionId: string) {
    this.modes.delete(sessionId);
  }

  getStatus(sessionId: string): PageInspectionPermissionStatus {
    const mode = this.modes.get(sessionId) ?? "none";
    const isAllowed = mode !== "none";
    return {
      isAllowed,
      mode,
      status: !this.dependencies.isChromiumAvailable()
        ? "browser_missing"
        : isAllowed
          ? "ready"
          : "blocked",
    };
  }

  listModes(): Record<string, PageInspectionAllowedMode> {
    return Object.fromEntries(this.modes);
  }
}

export const pageInspectionPermissionService = new PageInspectionPermissionService();
