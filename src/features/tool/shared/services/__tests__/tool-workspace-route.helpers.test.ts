import { describe, expect, test } from "bun:test";
import { isToolWorkspaceForRoute, shouldInitializeToolWorkspace } from "../tool-workspace-route.helpers";

describe("tool workspace route ownership", () => {
  test("hides a stale workspace until its tool and session match the route", () => {
    expect(isToolWorkspaceForRoute("curl", "session-1", "nmap", "session-1")).toBe(false);
    expect(isToolWorkspaceForRoute("nmap", "session-1", "nmap", "session-2")).toBe(false);
    expect(isToolWorkspaceForRoute("nmap", "session-1", "nmap", "session-1")).toBe(true);
    expect(shouldInitializeToolWorkspace("curl", "session-1", "nmap", "session-1", true)).toBe(false);
    expect(shouldInitializeToolWorkspace("curl", "session-1", "nmap", "session-1", false)).toBe(true);
    expect(shouldInitializeToolWorkspace("nmap", "session-1", "nmap", "session-1", false)).toBe(false);
  });
});
