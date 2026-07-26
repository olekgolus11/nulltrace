import { PageInspectionAllowedMode } from "../model/page-inspection.types";

export function readPageInspectionPermissionModes(): Record<string, PageInspectionAllowedMode> {
  if (!process.env.OPENCODE_CONFIG_CONTENT) {
    return {};
  }

  try {
    const value: unknown = JSON.parse(process.env.NULLTRACE_PAGE_INSPECTION_MODES ?? "{}");
    if (!value || typeof value !== "object" || Array.isArray(value)) {
      return {};
    }
    const modes: Record<string, PageInspectionAllowedMode> = {};
    Object.entries(value).forEach(([sessionId, mode]) => {
      if (mode === "public" || mode === "authenticated") {
        modes[sessionId] = mode;
      }
    });
    return modes;
  } catch {
    return {};
  }
}
