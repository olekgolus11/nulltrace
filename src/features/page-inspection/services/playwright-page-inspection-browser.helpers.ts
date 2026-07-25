import { existsSync } from "node:fs";
import { basename, dirname } from "node:path";
import { chromium } from "playwright";

export function isChromiumAvailable() {
  return existsSync(chromium.executablePath());
}

export function getPlaywrightBrowsersPath() {
  if (process.env.PLAYWRIGHT_BROWSERS_PATH) {
    return process.env.PLAYWRIGHT_BROWSERS_PATH;
  }

  let directory = chromium.executablePath();
  while (basename(directory) !== "ms-playwright") {
    const parent = dirname(directory);
    if (parent === directory) {
      return undefined;
    }
    directory = parent;
  }

  return directory;
}

export function isMissingChromiumError(error: unknown) {
  return error instanceof Error && /executable does not exist|please run.*playwright install/i.test(error.message);
}

export function toBoundedPageInspectionHeader(value: string | undefined) {
  return value?.slice(0, 2_000) ?? null;
}
