import { describe, expect, test } from "bun:test";
import { PageInspectionPermissionService } from "../page-inspection-permission.service";

describe("PageInspectionPermissionService", () => {
  test("defaults to no inspection and scopes public or authenticated mode to one session", () => {
    const service = new PageInspectionPermissionService({
      isChromiumAvailable: () => true,
    });

    expect(service.getStatus("session-one")).toEqual({
      isAllowed: false,
      mode: "none",
      status: "blocked",
    });

    service.allowPublic("session-one");

    expect(service.getStatus("session-one")).toEqual({
      isAllowed: true,
      mode: "public",
      status: "ready",
    });
    expect(service.getStatus("session-two")).toEqual({
      isAllowed: false,
      mode: "none",
      status: "blocked",
    });

    service.allowAuthenticated("session-one");
    expect(service.getStatus("session-one")).toEqual({
      isAllowed: true,
      mode: "authenticated",
      status: "ready",
    });
  });

  test("sets no inspection for an active session mode", () => {
    const service = new PageInspectionPermissionService({
      isChromiumAvailable: () => true,
    });
    service.allowAuthenticated("session-one");

    service.revoke("session-one");

    expect(service.getStatus("session-one")).toEqual({
      isAllowed: false,
      mode: "none",
      status: "blocked",
    });
  });

  test("reports missing Chromium without enabling inspection", () => {
    const service = new PageInspectionPermissionService({
      isChromiumAvailable: () => false,
    });
    service.allowPublic("session-one");

    expect(service.getStatus("session-one")).toEqual({
      isAllowed: true,
      mode: "public",
      status: "browser_missing",
    });
  });

  test("does not rehydrate a mode in the parent application process", () => {
    const previousConfig = process.env.OPENCODE_CONFIG_CONTENT;
    const previousModes = process.env.NULLTRACE_PAGE_INSPECTION_MODES;
    process.env.NULLTRACE_PAGE_INSPECTION_MODES = JSON.stringify({
      "session-one": "authenticated",
    });
    delete process.env.OPENCODE_CONFIG_CONTENT;

    try {
      const service = new PageInspectionPermissionService({ isChromiumAvailable: () => true });
      expect(service.getStatus("session-one")).toEqual({
        isAllowed: false,
        mode: "none",
        status: "blocked",
      });
    } finally {
      if (previousConfig === undefined) {
        delete process.env.OPENCODE_CONFIG_CONTENT;
      } else {
        process.env.OPENCODE_CONFIG_CONTENT = previousConfig;
      }
      if (previousModes === undefined) {
        delete process.env.NULLTRACE_PAGE_INSPECTION_MODES;
      } else {
        process.env.NULLTRACE_PAGE_INSPECTION_MODES = previousModes;
      }
    }
  });

  test("rehydrates the selected mode only inside the isolated chat runtime", () => {
    const previousConfig = process.env.OPENCODE_CONFIG_CONTENT;
    const previousModes = process.env.NULLTRACE_PAGE_INSPECTION_MODES;
    process.env.OPENCODE_CONFIG_CONTENT = "{}";
    process.env.NULLTRACE_PAGE_INSPECTION_MODES = JSON.stringify({
      "session-one": "authenticated",
    });

    try {
      const service = new PageInspectionPermissionService({ isChromiumAvailable: () => true });
      expect(service.getStatus("session-one")).toEqual({
        isAllowed: true,
        mode: "authenticated",
        status: "ready",
      });
    } finally {
      if (previousConfig === undefined) {
        delete process.env.OPENCODE_CONFIG_CONTENT;
      } else {
        process.env.OPENCODE_CONFIG_CONTENT = previousConfig;
      }
      if (previousModes === undefined) {
        delete process.env.NULLTRACE_PAGE_INSPECTION_MODES;
      } else {
        process.env.NULLTRACE_PAGE_INSPECTION_MODES = previousModes;
      }
    }
  });
});
