import type { BrowserType } from "playwright";

export interface PageInspectionBrowserDependencies {
  browserType: Pick<BrowserType, "launch">;
}
