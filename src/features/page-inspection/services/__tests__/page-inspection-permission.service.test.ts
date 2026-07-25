import { describe, expect, test } from "bun:test";
import { PageInspectionPermissionService } from "../page-inspection-permission.service";

describe("PageInspectionPermissionService", () => {
  test("blocks inspection by default and scopes a grant to one session", () => {
    const service = new PageInspectionPermissionService({
      isChromiumAvailable: () => true,
    });

    expect(service.getStatus("session-one")).toEqual({
      isAllowed: false,
      status: "blocked",
    });

    service.grant("session-one");

    expect(service.getStatus("session-one")).toEqual({
      isAllowed: true,
      status: "ready",
    });
    expect(service.getStatus("session-two")).toEqual({
      isAllowed: false,
      status: "blocked",
    });
  });

  test("revokes an active session grant", () => {
    const service = new PageInspectionPermissionService({
      isChromiumAvailable: () => true,
    });
    service.grant("session-one");

    service.revoke("session-one");

    expect(service.getStatus("session-one")).toEqual({
      isAllowed: false,
      status: "blocked",
    });
  });

  test("reports missing Chromium without enabling inspection", () => {
    const service = new PageInspectionPermissionService({
      isChromiumAvailable: () => false,
    });
    service.grant("session-one");

    expect(service.getStatus("session-one")).toEqual({
      isAllowed: true,
      status: "browser_missing",
    });
  });

  test("does not rehydrate a grant in the parent application process", () => {
    const previousConfig = process.env.OPENCODE_CONFIG_CONTENT;
    const previousGrants = process.env.NULLTRACE_PAGE_INSPECTION_SESSION_IDS;
    process.env.NULLTRACE_PAGE_INSPECTION_SESSION_IDS = JSON.stringify(["session-one"]);
    delete process.env.OPENCODE_CONFIG_CONTENT;

    try {
      const service = new PageInspectionPermissionService({ isChromiumAvailable: () => true });
      expect(service.getStatus("session-one")).toEqual({
        isAllowed: false,
        status: "blocked",
      });
    } finally {
      if (previousConfig === undefined) {
        delete process.env.OPENCODE_CONFIG_CONTENT;
      } else {
        process.env.OPENCODE_CONFIG_CONTENT = previousConfig;
      }
      if (previousGrants === undefined) {
        delete process.env.NULLTRACE_PAGE_INSPECTION_SESSION_IDS;
      } else {
        process.env.NULLTRACE_PAGE_INSPECTION_SESSION_IDS = previousGrants;
      }
    }
  });
});
